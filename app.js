import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { DiscordRequest } from './utils.js';
import { saveStudySession, getUserStats, getGuildStats, getUserHeatmapData } from './db-utils.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Timer state management
const activeTimers = new Map();
// Track completion messages
const completionMessages = new Map();

// Timer states
const TimerState = {
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed'
};

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async (req, res) => {
  const { type, data, member, guild_id, channel_id, message } = req.body;

  // Handle Discord PING
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  // Handle command interactions
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    switch (name) {
      case 'timer':
        return handleTimerCommand(req, res);
      case 'stats':
        return handleStatsCommand(req, res, member, guild_id);
      case 'leaderboard':
        return handleLeaderboardCommand(req, res, guild_id);
      default:
        console.error(`Unknown command: ${name}`);
        return res.status(400).json({ error: 'Unknown command' });
    }
  }

  // Handle message component interactions (buttons)
  if (type === InteractionType.MESSAGE_COMPONENT) {
    const componentId = data.custom_id;

    // Timer control buttons
    if (componentId.startsWith('timer_')) {
      return handleTimerControlButton(req, res, componentId, member, guild_id);
    }

    // Task completion buttons
    if (componentId === 'task_complete' || componentId === 'task_incomplete') {
      // Pass message info so we can update it
      return handleTaskCompletionButton(req, res, componentId, member, guild_id, message);
    }
  }

  console.error('Unknown interaction type', type);
  return res.status(400).json({ error: 'Unknown interaction type' });
});

/**
 * Handles the /timer command
 */
async function handleTimerCommand(req, res) {
  const { data, member, guild_id, channel_id } = req.body;
  const input = data.options?.[0]?.value || '';
  const { duration, task } = parseTimerInput(input, member.user.username);

  // Create a unique timer ID
  const timerId = `${member.user.id}_${guild_id}`;

  // Create timer info
  const timerInfo = {
    userId: member.user.id,
    task,
    duration,
    startTime: Math.floor(Date.now() / 1000), // Store as unix seconds for Discord timestamp
    endTime: Math.floor(Date.now() / 1000) + duration,
    state: TimerState.RUNNING,
    guildId: guild_id,
    channelId: channel_id,
    messageId: null, // Will be set after response
    saved: false // Track if this session has been saved to DB
  };

  // Store the timer
  activeTimers.set(timerId, timerInfo);

  // Schedule the timer completion notification
  scheduleTimerEnd(timerInfo);

  // Format duration for display
  const durationDisplay = formatDurationDisplay(duration);

  return res.send({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: createTimerMessage(timerInfo),
      components: createTimerControls(TimerState.RUNNING)
    },
  });
}

/**
 * Handles the /stats command
 */
async function handleStatsCommand(req, res, member, guild_id) {
  try {
    const [stats, heatmapData] = await Promise.all([
      getUserStats(member.user.id),
      getUserHeatmapData(member.user.id)
    ]);

    const statsMessage =
      `📊 **Your Study Statistics**\n\n` +
      `• Total sessions: ${stats.total_sessions || 0}\n` +
      `• Total time: ${formatTotalTime(stats.total_minutes || 0)}\n` +
      `• Last session: ${stats.last_session ? new Date(stats.last_session).toLocaleDateString() : 'No sessions yet'}\n\n` +
      generateStudyHeatmap(heatmapData);

    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: statsMessage,
        flags: InteractionResponseFlags.EPHEMERAL
      },
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ There was an error fetching your statistics.',
        flags: InteractionResponseFlags.EPHEMERAL
      },
    });
  }
}

/**
 * Handles the /leaderboard command
 */
async function handleLeaderboardCommand(req, res, guild_id) {
  try {
    const stats = await getGuildStats(guild_id);

    if (!stats || stats.length === 0) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '📊 No study sessions have been recorded in this server yet!'
        },
      });
    }

    const leaderboardEntries = stats.map((stat, index) =>
      `${getLeaderboardMedal(index)} <@${stat.user_id}>: ${formatTotalTime(stat.total_minutes)} (${stat.sessions_completed} sessions)`
    ).join('\n');

    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `📊 **Study Leaderboard**\n\n${leaderboardEntries}`
      },
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ There was an error fetching the leaderboard.'
      },
    });
  }
}

/**
 * Handles timer control buttons (pause, resume, stop)
 */
async function handleTimerControlButton(req, res, componentId, member, guild_id) {
  const timerId = `${member.user.id}_${guild_id}`;
  const timerInfo = activeTimers.get(timerId);

  // Verify timer exists and belongs to user
  if (!timerInfo) {
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "⚠️ This timer doesn't exist or has already expired.",
        flags: InteractionResponseFlags.EPHEMERAL
      }
    });
  }

  if (timerInfo.userId !== member.user.id) {
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "⚠️ You can only control your own timers!",
        flags: InteractionResponseFlags.EPHEMERAL
      }
    });
  }

  // Process the button action
  switch (componentId) {
    case 'timer_pause':
      if (timerInfo.state === TimerState.RUNNING) {
        // Calculate remaining time and save it
        const now = Math.floor(Date.now() / 1000);
        timerInfo.remainingTime = timerInfo.endTime - now;
        timerInfo.pausedAt = now;
        timerInfo.state = TimerState.PAUSED;

        // Cancel the existing timeout
        if (timerInfo.timeoutId) {
          clearTimeout(timerInfo.timeoutId);
          timerInfo.timeoutId = null;
        }
      }
      break;

    case 'timer_resume':
      if (timerInfo.state === TimerState.PAUSED) {
        // Calculate new end time
        const now = Math.floor(Date.now() / 1000);
        timerInfo.endTime = now + timerInfo.remainingTime;
        timerInfo.state = TimerState.RUNNING;

        // Reschedule timer
        scheduleTimerEnd(timerInfo);
      }
      break;

    case 'timer_stop':
      // Stop the timer
      if (timerInfo.timeoutId) {
        clearTimeout(timerInfo.timeoutId);
      }

      // Calculate elapsed time
      const elapsedTime = calculateElapsedTime(timerInfo);

      // Save session if it's at least 1 minute (60 seconds)
      if (elapsedTime >= 60 && !timerInfo.saved) {
        try {
          await saveStudySession(
            member.user.id,
            timerInfo.task,
            elapsedTime,
            guild_id
          );

          timerInfo.saved = true;
          const stats = await getUserStats(member.user.id);

          return res.send({
            type: InteractionResponseType.UPDATE_MESSAGE,
            data: {
              content: `⏹️ **Timer Stopped**\n\n` +
                `⏱️ Duration: ${formatDurationDisplay(elapsedTime)}\n` +
                `📝 Task: ${timerInfo.task}\n\n` +
                `✅ Session saved! Your updated stats:\n` +
                `• Total sessions: ${stats.total_sessions}\n` +
                `• Total time: ${formatTotalTime(stats.total_minutes)}`,
              components: [] // Remove all buttons
            }
          });
        } catch (error) {
          console.error('Error saving stopped session:', error);
          return res.send({
            type: InteractionResponseType.UPDATE_MESSAGE,
            data: {
              content: `⏹️ **Timer Stopped**\n\n` +
                `⏱️ Duration: ${formatDurationDisplay(elapsedTime)}\n` +
                `📝 Task: ${timerInfo.task}\n\n` +
                `(Note: There was an error saving your stats)`,
              components: [] // Remove all buttons
            }
          });
        }
      } else {
        let message = `⏹️ **Timer Stopped**\n\n` +
          `⏱️ Duration: ${formatDurationDisplay(elapsedTime)}\n` +
          `📝 Task: ${timerInfo.task}`;

        if (elapsedTime < 60) {
          message += `\n\nNote: Sessions under 1 minute are not saved.`;
        } else if (timerInfo.saved) {
          message += `\n\nNote: This session was already saved.`;
        }

        return res.send({
          type: InteractionResponseType.UPDATE_MESSAGE,
          data: {
            content: message,
            components: [] // Remove all buttons
          }
        });
      }

      // Remove the timer
      activeTimers.delete(timerId);
      break;
  }

  // Update the timer message
  return res.send({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      content: createTimerMessage(timerInfo),
      components: createTimerControls(timerInfo.state)
    }
  });
}

/**
 * Handles task completion buttons
 */
async function handleTaskCompletionButton(req, res, componentId, member, guild_id, message) {
  const timerId = `${member.user.id}_${guild_id}`;
  const timerInfo = activeTimers.get(timerId);

  // Check if timer exists
  if (!timerInfo) {
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "⚠️ Couldn't find your timer session.",
        flags: InteractionResponseFlags.EPHEMERAL
      }
    });
  }

  // Verify this is the timer owner
  if (timerInfo.userId !== member.user.id) {
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "⚠️ You can only respond to your own timers!",
        flags: InteractionResponseFlags.EPHEMERAL
      }
    });
  }

  // Check if this session was already saved
  if (timerInfo.saved) {
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "⚠️ This session has already been saved to the database.",
        flags: InteractionResponseFlags.EPHEMERAL
      }
    });
  }

  // Calculate the duration of the session
  const sessionDuration = calculateElapsedTime(timerInfo);

  // Don't save sessions under 1 minute
  if (sessionDuration < 60) {
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "⚠️ Sessions under 1 minute are not saved.",
        flags: InteractionResponseFlags.EPHEMERAL
      }
    });
  }

  try {
    // Save the session
    await saveStudySession(
      member.user.id,
      timerInfo.task,
      sessionDuration,
      guild_id
    );

    // Mark as saved to prevent duplicate saves
    timerInfo.saved = true;
    timerInfo.state = TimerState.COMPLETED;

    // Get updated stats
    const stats = await getUserStats(member.user.id);

    // Update the original message to show completion
    let completionStatus = componentId === 'task_complete'
      ? `✅ **Task Completed**`
      : `📝 **Session Recorded**`;

    let updatedMessage = `${completionStatus}\n\n` +
      `👤 <@${member.user.id}>\n` +
      `⏱️ Duration: ${formatDurationDisplay(sessionDuration)}\n` +
      `📝 Task: ${timerInfo.task}`;

    // First update the message
    await updateOriginalMessage(message.channel_id, message.id, updatedMessage);

    // Then send ephemeral message with stats to the user
    let statsMessage = componentId === 'task_complete'
      ? `🎉 Great job completing your task!`
      : `💪 Progress is still progress!`;

    statsMessage += `\n\nYour updated stats:\n` +
      `• Total sessions: ${stats.total_sessions}\n` +
      `• Total time: ${formatTotalTime(stats.total_minutes)}`;

    if (componentId === 'task_incomplete') {
      statsMessage += `\n\nWould you like to start another timer?`;
    }

    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: statsMessage,
        flags: InteractionResponseFlags.EPHEMERAL
      }
    });
  } catch (error) {
    console.error('Error saving session:', error);
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `❌ Error saving your session. Please try again.`,
        flags: InteractionResponseFlags.EPHEMERAL
      }
    });
  }
}

/**
 * Updates an existing message
 */
async function updateOriginalMessage(channelId, messageId, content) {
  try {
    const endpoint = `channels/${channelId}/messages/${messageId}`;
    await DiscordRequest(endpoint, {
      method: 'PATCH',
      body: {
        content: content,
        components: [] // Remove buttons
      }
    });
    return true;
  } catch (error) {
    console.error('Error updating message:', error);
    return false;
  }
}

/**
 * Deletes a message
 */
async function deleteMessage(channelId, messageId) {
  try {
    const endpoint = `channels/${channelId}/messages/${messageId}`;
    await DiscordRequest(endpoint, {
      method: 'DELETE'
    });
    return true;
  } catch (error) {
    console.error('Error deleting message:', error);
    return false;
  }
}

/**
 * Schedules the timer completion notification
 */
function scheduleTimerEnd(timerInfo) {
  // Calculate how many milliseconds until the timer ends
  const now = Math.floor(Date.now() / 1000);
  const msUntilEnd = (timerInfo.endTime - now) * 1000;

  // Clear any existing timeout
  if (timerInfo.timeoutId) {
    clearTimeout(timerInfo.timeoutId);
  }

  // Don't schedule if timer is already past end time
  if (msUntilEnd <= 0) {
    sendTimerCompletionMessage(timerInfo);
    return;
  }

  // Schedule the timer end notification
  timerInfo.timeoutId = setTimeout(() => {
    if (timerInfo.state === TimerState.RUNNING) {
      sendTimerCompletionMessage(timerInfo);
    }
  }, msUntilEnd);
}

/**
 * Sends the timer completion message with buttons
 */
async function sendTimerCompletionMessage(timerInfo) {
  try {
    // Create a new message with buttons
    const endpoint = `channels/${timerInfo.channelId}/messages`;
    const response = await DiscordRequest(endpoint, {
      method: 'POST',
      body: {
        content: `<@${timerInfo.userId}> ⏰ **Time's up!** Did you complete your task?\n📝 Task: ${timerInfo.task}`,
        components: [
          {
            type: MessageComponentTypes.ACTION_ROW,
            components: [
              {
                type: MessageComponentTypes.BUTTON,
                custom_id: 'task_complete',
                label: 'Yes, completed! ✅',
                style: ButtonStyleTypes.SUCCESS,
              },
              {
                type: MessageComponentTypes.BUTTON,
                custom_id: 'task_incomplete',
                label: 'Not yet ❌',
                style: ButtonStyleTypes.SECONDARY,
              }
            ],
          },
        ],
      },
    });

    // Store the message ID so we can update it later
    if (response.ok) {
      const messageData = await response.json();
      if (messageData && messageData.id) {
        // Store the message ID with the timer info
        completionMessages.set(`${timerInfo.userId}_${timerInfo.guildId}`, {
          messageId: messageData.id,
          channelId: timerInfo.channelId
        });
      }
    }
  } catch (err) {
    console.error('Error sending timer completion message:', err);
  }
}

/**
 * Creates the timer message with Discord timestamps
 */
function createTimerMessage(timerInfo) {
  let message = '';

  if (timerInfo.state === TimerState.RUNNING) {
    message = `⏱️ **Timer Running**\n\n` +
      `⏰ Started: <t:${timerInfo.startTime}:R>\n` +
      `⏰ Ends: <t:${timerInfo.endTime}:R>\n` +
      `⏰ Duration: ${formatDurationDisplay(timerInfo.duration)}\n` +
      `📝 Task: ${timerInfo.task}`;
  } else if (timerInfo.state === TimerState.PAUSED) {
    message = `⏸️ **Timer Paused**\n\n` +
      `⏰ Started: <t:${timerInfo.startTime}:R>\n` +
      `⏰ Paused: <t:${timerInfo.pausedAt}:R>\n` +
      `⏰ Time Remaining: ${formatDurationDisplay(timerInfo.remainingTime)}\n` +
      `📝 Task: ${timerInfo.task}`;
  }

  return message;
}

/**
 * Creates timer control buttons based on state
 */
function createTimerControls(timerState) {
  const buttons = [];

  if (timerState === TimerState.RUNNING) {
    buttons.push({
      type: MessageComponentTypes.BUTTON,
      custom_id: 'timer_pause',
      label: '⏸️ Pause',
      style: ButtonStyleTypes.PRIMARY,
    });
  } else if (timerState === TimerState.PAUSED) {
    buttons.push({
      type: MessageComponentTypes.BUTTON,
      custom_id: 'timer_resume',
      label: '▶️ Resume',
      style: ButtonStyleTypes.SUCCESS,
    });
  }

  buttons.push({
    type: MessageComponentTypes.BUTTON,
    custom_id: 'timer_stop',
    label: '⏹️ Stop',
    style: ButtonStyleTypes.DANGER,
  });

  return [{
    type: MessageComponentTypes.ACTION_ROW,
    components: buttons
  }];
}

/**
 * Parses the timer input to extract duration and task
 */
function parseTimerInput(input, username) {
  // Default values
  let duration = 25 * 60; // 25 minutes in seconds
  let task = `${username}'s study session`;

  if (!input) return { duration, task };

  // Regular expression for duration patterns (h, m, s)
  const durationRegex = /^(\d+)\s*([hms])/i;
  const match = input.match(durationRegex);

  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    // Convert to seconds
    switch (unit) {
      case 'h':
        duration = value * 3600;
        break;
      case 'm':
        duration = value * 60;
        break;
      case 's':
        duration = value;
        break;
    }

    // Extract task from remaining input
    task = input.slice(match[0].length).trim();

    // Default task if none provided
    if (!task) {
      task = `${username}'s study session`;
    }
  } else {
    // If no duration pattern found, treat as task description
    task = input.trim() || `${username}'s study session`;
  }

  return { duration, task };
}

/**
 * Formats a duration in seconds for display
 */
function formatDurationDisplay(seconds) {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ?
      `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}` :
      `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
}

/**
 * Formats total time for stats display
 */
function formatTotalTime(totalMinutes) {
  if (!totalMinutes) return '0 minutes';

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);

  if (hours === 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (minutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  } else {
    return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
}

/**
 * Gets medal emoji for leaderboard position
 */
function getLeaderboardMedal(position) {
  switch (position) {
    case 0: return '🥇';
    case 1: return '🥈';
    case 2: return '🥉';
    default: return `${position + 1}.`;
  }
}

/**
 * Calculates elapsed time for a timer in seconds
 */
function calculateElapsedTime(timerInfo) {
  if (timerInfo.state === TimerState.PAUSED) {
    // For paused timers, calculate based on when it was paused
    return Math.floor(timerInfo.duration - timerInfo.remainingTime);
  } else {
    // For running or completed timers
    const endTime = Math.min(
      Math.floor(Date.now() / 1000),
      timerInfo.endTime
    );
    return Math.floor(endTime - timerInfo.startTime);
  }
}

/**
 * Generates study pattern heatmap
 */
function generateStudyHeatmap(data) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const timeBlocks = [
    '12am-4am',
    '4am-8am ',
    '8am-12pm',
    '12pm-4pm',
    '4pm-8pm ',
    '8pm-12am'
  ];

  function getEmoji(value) {
    if (!value) return '⬜'; // White square for no activity
    if (value < 30) return '🟦'; // Light activity
    if (value < 60) return '🟪'; // Medium activity
    return '⬛'; // Heavy activity
  }

  // Create header
  let heatmap = '📊 **Your Study Pattern (Last 30 Days)**\n\n';

  // Start code block
  heatmap += '```\n';

  // Add day headers with proper spacing
  heatmap += '          '; // Indent for time labels
  days.forEach(day => {
    heatmap += day + ' ';
  });
  heatmap += '\n';

  // Add data rows with proper spacing
  timeBlocks.forEach((timeBlock, i) => {
    // Add time block label with fixed width
    heatmap += timeBlock.padEnd(10, ' ');

    // Add squares for each day
    days.forEach(day => {
      let total = 0;
      for (let hour = i * 4; hour < (i + 1) * 4; hour++) {
        const key = `${day}-${hour}`;
        total += data[key] || 0;
      }
      const average = total / 4;
      heatmap += getEmoji(average) + ' ';
    });
    heatmap += '\n';
  });

  // Close code block
  heatmap += '```\n';

  // Add legend (outside code block for better emoji rendering)
  heatmap += 'Legend:\n';
  heatmap += '⬜ No study  🟦 < 30m/hr  🟪 30-60m/hr  ⬛ > 60m/hr';

  return heatmap;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Pomodoro Bot server running on port ${PORT}`);
});

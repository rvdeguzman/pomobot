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
import { getRandomEmoji, DiscordRequest } from './utils.js';
import { saveStudySession, getUserStats, getGuildStats, getUserHeatmapData } from './db-utils.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced timer tracking with state
const activeTimers = {};

// Timer states
const TimerState = {
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped'
};

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function(req, res) {
  const { id, type, data, member, guild_id } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    const componentId = data.custom_id;
    const timerId = member.user.id + '_' + guild_id;
    const timerInfo = activeTimers[timerId];

    // Check if this is a timer control button
    if (componentId.startsWith('timer_')) {
      // Verify the user owns this timer
      if (!timerInfo || timerInfo.userId !== member.user.id) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: "⚠️ You can only control your own timer!",
            flags: InteractionResponseFlags.EPHEMERAL
          }
        });
      }

      switch (componentId) {
        case 'timer_pause':
          if (timerInfo.state === TimerState.RUNNING) {
            timerInfo.state = TimerState.PAUSED;
            timerInfo.pausedAt = Date.now();
            timerInfo.remainingTime = timerInfo.endTime - Date.now();
            clearTimeout(timerInfo.timeoutId);
          }
          break;

        case 'timer_resume':
          if (timerInfo.state === TimerState.PAUSED) {
            timerInfo.state = TimerState.RUNNING;
            timerInfo.endTime = Date.now() + timerInfo.remainingTime;
            scheduleTimerEnd(req.body.token, timerInfo);
          }
          break;

        case 'timer_stop':
          timerInfo.state = TimerState.STOPPED;
          clearTimeout(timerInfo.timeoutId);

          // Calculate elapsed time in seconds
          const elapsedTime = Math.floor((Date.now() - timerInfo.startTime) / 1000);

          // If session was at least 10 minutes (600 seconds), save it
          if (elapsedTime >= 6) {
            try {
              await saveStudySession(
                member.user.id,
                timerInfo.task,
                elapsedTime,
                guild_id
              );

              const stats = await getUserStats(member.user.id);
              delete activeTimers[timerId];

              return res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `⏹️ Timer stopped after ${Math.floor(elapsedTime / 60)} minutes ${elapsedTime % 60} seconds.\nSession saved! Your updated stats:\n• Total sessions: ${stats.total_sessions}\n• Total time: ${Math.floor(stats.total_minutes / 3600)} hours ${Math.floor((stats.total_minutes % 3600) / 60)} minutes`,
                  flags: InteractionResponseFlags.EPHEMERAL
                }
              });
            } catch (error) {
              console.error('Error saving stopped session:', error);
              delete activeTimers[timerId];
              return res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: `⏹️ Timer stopped after ${Math.floor(elapsedTime / 60)} minutes ${elapsedTime % 60} seconds.\n(Note: There was an error saving your stats)`,
                  flags: InteractionResponseFlags.EPHEMERAL
                }
              });
            }
          } else {
            delete activeTimers[timerId];
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `⏹️ Timer stopped after ${Math.floor(elapsedTime / 60)} minutes ${elapsedTime % 60} seconds.\nNote: Sessions under 10 minutes are not saved.`,
                flags: InteractionResponseFlags.EPHEMERAL
              }
            });
          }
      }

      // Update the timer message with new buttons
      return res.send({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: getTimerContent(timerInfo),
          components: getTimerButtons(timerInfo.state)
        }
      });
    }

    if (componentId === 'task_complete' && timerInfo) {
      try {
        await saveStudySession(
          member.user.id,
          timerInfo.task,
          timerInfo.duration,
          guild_id
        );

        const stats = await getUserStats(member.user.id);

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `🎉 Great job completing your task!\n\nYour stats:\n• Total sessions: ${stats.total_sessions}\n• Total time: ${Math.floor(stats.total_minutes / 3600)} hours ${Math.floor((stats.total_minutes % 3600) / 60)} minutes`, flags: InteractionResponseFlags.EPHEMERAL
          },
        });
      } catch (error) {
        console.error('Error handling task completion:', error);
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '🎉 Great job completing your task! (Note: There was an error saving your stats)',
            flags: InteractionResponseFlags.EPHEMERAL
          },
        });
      }
    }


    if (componentId === 'task_incomplete') {
      // Get the timer info
      const timerId = member.user.id + '_' + guild_id;
      const timerInfo = activeTimers[timerId];

      if (timerInfo) {
        // Calculate elapsed time in seconds
        const elapsedTime = Math.floor((timerInfo.endTime - timerInfo.startTime) / 1000);

        // If session was at least 10 minutes (600 seconds), save it
        if (elapsedTime >= 600) { // TODO: Change this to 10 mins
          try {
            await saveStudySession(
              member.user.id,
              timerInfo.task,
              elapsedTime,
              guild_id
            );

            const stats = await getUserStats(member.user.id);
            delete activeTimers[timerId];

            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `💪 That's okay! The ${Math.floor(elapsedTime / 60)} minute session has been recorded.\n\nYour updated stats:\n• Total sessions: ${stats.total_sessions}\n• Total time: ${Math.floor(stats.total_minutes / 3600)} hours ${Math.floor((stats.total_minutes % 3600) / 60)} minutes\n\nWould you like to start another timer to continue working on it?`,
                flags: InteractionResponseFlags.EPHEMERAL
              },
            });
          } catch (error) {
            console.error('Error saving incomplete session:', error);
            delete activeTimers[timerId];
          }
        }
      }

      // Default response if session was under 10 minutes or if there was an error
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '💪 That\'s okay! Would you like to start another timer to continue working on it?',
          flags: InteractionResponseFlags.EPHEMERAL
        },
      });
    }

  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'timer') {
      const input = data.options?.[0]?.value || '';
      const username = member.user.username;
      const { duration, task } = parseTimerInput(input, username);

      const timerId = `${member.user.id}_${guild_id}`;
      const timerInfo = createTimerInfo(
        member.user.id,
        task,
        duration,
        guild_id,
        req.body.token
      );

      // Store channel ID for later use
      timerInfo.channelId = req.body.channel_id;

      activeTimers[timerId] = timerInfo;
      scheduleTimerEnd(timerInfo);

      // Format duration for display
      const durationDisplay = formatDurationDisplay(duration);

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `⏱️ Timer Started\n⏰ Duration: ${durationDisplay}\n⏰ Ends <t:${Math.floor(timerInfo.endTime / 1000)}:R>\n📝 Task: ${task}`,
          components: getTimerButtons(TimerState.RUNNING)
        },
      });
    }

    if (name === 'stats') {
      try {
        const [stats, heatmapData] = await Promise.all([
          getUserStats(member.user.id),
          getUserHeatmapData(member.user.id)
        ]);

        const statsMessage =
          `📊 Your Study Statistics:\n` +
          `• Total sessions: ${stats.total_sessions}\n` +
          `• Total time: ${Math.floor(stats.total_minutes / 3600)} hours ${Math.floor((stats.total_minutes % 3600) / 60)} minutes\n` +
          `• Last session: ${new Date(stats.last_session).toLocaleDateString()}\n\n` +
          generateDiscordHeatmap(heatmapData);

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
            content: 'Sorry, there was an error fetching your statistics.',
            flags: InteractionResponseFlags.EPHEMERAL
          },
        });
      }
    }

    if (name === 'leaderboard') {
      try {
        const stats = await getGuildStats(guild_id);
        const leaderboard = stats.map((stat, index) =>
          `${index + 1}. <@${stat.user_id}>: ${Math.floor(stat.total_minutes / 3600)}h ${Math.floor((stat.total_minutes % 3600) / 60)}m (${stat.sessions_completed} sessions)`
        ).join('\n');

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `📊 Study Leaderboard:\n${leaderboard}`,
          },
        });
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Sorry, there was an error fetching the leaderboard.',
          },
        });
      }
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

// Helper function to get timer message content
function getTimerContent(timerInfo) {
  const remainingTime = timerInfo.state === TimerState.PAUSED ?
    timerInfo.remainingTime :
    timerInfo.endTime - Date.now();

  const secondsLeft = Math.max(0, Math.ceil(remainingTime / 1000));
  const minutesLeft = Math.floor(secondsLeft / 60);
  const remainingSeconds = secondsLeft % 60;

  const endTime = new Date(timerInfo.endTime);
  const endTimeString = endTime.toLocaleTimeString();

  let status = '⏱️ Running';
  if (timerInfo.state === TimerState.PAUSED) status = '⏸️ Paused';
  if (timerInfo.state === TimerState.STOPPED) status = '⏹️ Stopped';

  return `${status}\n⏰ Time remaining: ${minutesLeft}:${remainingSeconds.toString().padStart(2, '0')}\n🔔 Ends at: ${endTimeString}\n📝 Task: ${timerInfo.task}`;
}

// Helper function to get timer control buttons
function getTimerButtons(state) {
  const buttons = [];

  if (state === TimerState.RUNNING) {
    buttons.push({
      type: MessageComponentTypes.BUTTON,
      custom_id: 'timer_pause',
      label: '⏸️ Pause',
      style: ButtonStyleTypes.PRIMARY,
    });
  } else if (state === TimerState.PAUSED) {
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

// Helper function to schedule timer end
async function scheduleTimerEnd(timerInfo) {
  const timeLeft = timerInfo.endTime - Date.now();

  timerInfo.timeoutId = setTimeout(async () => {
    if (timerInfo.state !== TimerState.RUNNING) return;

    const timerId = `${timerInfo.userId}_${timerInfo.guildId}`;

    try {
      // Create a new message with buttons instead of updating the old one
      const endpoint = `channels/${timerInfo.channelId}/messages`;
      await DiscordRequest(endpoint, {
        method: 'POST',
        body: {
          content: `<@${timerInfo.userId}> ⏰ Time is up! Did you complete your task?\n📝 Task: ${timerInfo.task}`,
          flags: InteractionResponseFlags.SUPPRESS_EMBEDS,
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
                  label: 'No, not yet ❌',
                  style: ButtonStyleTypes.DANGER,
                }
              ],
            },
          ],
        },
      });
    } catch (err) {
      console.error('Error sending timer completion message:', err);
      // Clean up the timer even if message fails
      delete activeTimers[timerId];
    }
  }, timeLeft);
}

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});


function parseTimerInput(input, username) {
  // Default values
  let duration = 25 * 60; // 25 minutes in seconds
  let task = `${username}'s timer`;

  if (!input) return { duration, task };

  // Regular expression to match duration patterns (now including seconds)
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

    // Remove the duration part from input to get the task
    task = input.slice(match[0].length).trim();
  } else {
    // If no duration specified, treat entire input as task
    task = input.trim();
  }

  // If task is empty after parsing duration, use default personalized task
  if (!task) {
    task = `${username}'s timer`;
  }

  return { duration, task };
}
function generateDiscordHeatmap(data) {
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

function createTimerInfo(userId, task, duration, guildId, token) {
  return {
    userId,
    task,
    duration,
    startTime: Date.now(),
    endTime: Date.now() + (duration * 1000),
    state: TimerState.RUNNING,
    guildId,
    interactionToken: token // Store the token
  };
}
function formatDurationDisplay(duration) {
  if (duration < 60) {
    return `${duration} seconds`;
  } else if (duration < 3600) {
    return `${Math.floor(duration / 60)} minutes`;
  } else {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    return minutes > 0 ?
      `${hours} hours ${minutes} minutes` :
      `${hours} hours`;
  }
}

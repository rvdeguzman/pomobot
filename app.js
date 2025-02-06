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
import { saveStudySession, getUserStats, getGuildStats } from './db-utils.js';

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// To keep track of our active timers
const activeTimers = {};

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function(req, res) {
  const { id, type, data, member, guild_id } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    const componentId = data.custom_id;

    // Extract timer info from the stored data
    const timerId = member.user.id + '_' + guild_id;
    const timerInfo = activeTimers[timerId];

    if (componentId === 'task_complete' && timerInfo) {
      try {
        // Save the completed session
        await saveStudySession(
          member.user.id,
          timerInfo.task,
          timerInfo.duration,
          guild_id
        );

        // Get updated stats
        const stats = await getUserStats(member.user.id);

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `🎉 Great job completing your task!\n\nYour stats:\n• Total sessions: ${stats.total_sessions}\n• Total time: ${Math.floor(stats.total_minutes / 60)} hours ${stats.total_minutes % 60} minutes`,
            flags: InteractionResponseFlags.EPHEMERAL
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
      const duration = data.options.find(opt => opt.name === 'duration')?.value || 5;
      const task = data.options.find(opt => opt.name === 'task')?.value || "Unspecified task";

      // Store timer information
      const timerId = member.user.id + '_' + guild_id;
      activeTimers[timerId] = {
        task,
        duration,
        startTime: Date.now()
      };

      await res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `⏱️ Starting timer for ${duration} seconds...\n📝 Task: ${task}`,
        },
      });

      setTimeout(async () => {
        const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}`;
        try {
          await DiscordRequest(endpoint, {
            method: 'POST',
            body: {
              content: `⏰ Time is up! Did you complete your task?\n📝 Task: ${task}`,
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
        }
      }, duration * 1000);

      return;
    }

    if (name === 'stats') {
      try {
        const stats = await getUserStats(member.user.id);
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `📊 Your Study Statistics:\n• Total sessions: ${stats.total_sessions}\n• Total time: ${Math.floor(stats.total_minutes / 60)} hours ${stats.total_minutes % 60} minutes\n• Last session: ${new Date(stats.last_session).toLocaleDateString()}`,
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
          `${index + 1}. <@${stat.user_id}>: ${Math.floor(stat.total_minutes / 60)}h ${stat.total_minutes % 60}m (${stat.sessions_completed} sessions)`
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

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});

import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

// Timer command - start a pomodoro timer
const TIMER_COMMAND = {
  name: 'timer',
  description: 'Start a study timer',
  type: 1, // CHAT_INPUT
  options: [
    {
      type: 3, // STRING
      name: 'input',
      description: 'Duration and task (e.g. "25m study math" or "1h coding")',
      required: false
    }
  ]
};

// Stats command - view personal study statistics
const STATS_COMMAND = {
  name: 'stats',
  description: 'View your study statistics and patterns',
  type: 1, // CHAT_INPUT
};

// Leaderboard command - view server study leaderboard
const LEADERBOARD_COMMAND = {
  name: 'leaderboard',
  description: 'View the server study leaderboard',
  type: 1, // CHAT_INPUT
};

// Help command - get help with the bot
const HELP_COMMAND = {
  name: 'help',
  description: 'Get help with using the StudyBot',
  type: 1, // CHAT_INPUT
};

// Register all commands with Discord API
const ALL_COMMANDS = [
  TIMER_COMMAND,
  STATS_COMMAND,
  LEADERBOARD_COMMAND,
  HELP_COMMAND
];

// Log the commands being registered
console.log('Registering commands with Discord API:', ALL_COMMANDS.map(cmd => cmd.name).join(', '));

// Install commands globally to make them available in all servers
InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);

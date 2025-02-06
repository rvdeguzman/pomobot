import 'dotenv/config';
import { getRPSChoices } from './game.js';
import { capitalize, InstallGlobalCommands } from './utils.js';

// Get the game choices from game.js
function createCommandChoices() {
  const choices = getRPSChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice),
      value: choice.toLowerCase(),
    });
  }

  return commandChoices;
}

// Simple test command
const TEST_COMMAND = {
  name: 'test',
  description: 'Basic command',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

// Command containing options
const CHALLENGE_COMMAND = {
  name: 'challenge',
  description: 'is the change working',
  options: [
    {
      type: 3,
      name: 'object',
      description: 'Pick your object',
      required: true,
      choices: createCommandChoices(),
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
};

const POMO_COMMAND = {
  name: 'timer',
  description: 'Start a pomodoro timer',
  type: 1,
  options: [
    {
      type: 3,
      name: 'task',
      description: 'What task are you working on?',
      required: false
    },
    {
      type: 4,
      name: 'duration',
      description: 'Duration in seconds (default: 5)',
      required: false
    },
  ]
};

const STATS_COMMAND = {
  name: 'stats',
  description: 'View your study statistics',
  type: 1,
};

const LEADERBOARD_COMMAND = {
  name: 'leaderboard',
  description: 'View the server study leaderboard',
  type: 1,
};

// Update ALL_COMMANDS array to include the new commands
const ALL_COMMANDS = [TEST_COMMAND, CHALLENGE_COMMAND, POMO_COMMAND, STATS_COMMAND, LEADERBOARD_COMMAND];
// Log the commands being registered
console.log('Registering commands:', ALL_COMMANDS);

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);

import 'dotenv/config';

/**
 * Makes a request to the Discord API
 * 
 * @param {string} endpoint - API endpoint to call
 * @param {object} options - Request options
 * @returns {Promise<Response>} - Fetch response
 */
export async function DiscordRequest(endpoint, options) {
  // API base URL
  const url = 'https://discord.com/api/v10/' + endpoint;

  // Stringify JSON payloads
  if (options.body) {
    options.body = JSON.stringify(options.body);
  }

  // Set up the request headers
  const headers = {
    Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': 'StudyBotDiscord/1.0.0'
  };

  // Make the request
  try {
    const res = await fetch(url, {
      headers,
      ...options
    });

    // Handle API errors
    if (!res.ok) {
      const data = await res.json();
      console.error(`Discord API Error: ${res.status} ${res.statusText}`);
      console.error(data);
      throw new Error(JSON.stringify(data));
    }

    return res;
  } catch (error) {
    console.error('Error making Discord API request:', error);
    throw error;
  }
}

/**
 * Installs or updates global commands for the Discord application
 * 
 * @param {string} appId - Discord application ID
 * @param {Array} commands - Array of command objects
 */
export async function InstallGlobalCommands(appId, commands) {
  // API endpoint to register global commands
  const endpoint = `applications/${appId}/commands`;

  try {
    // Bulk overwrite all commands
    await DiscordRequest(endpoint, { method: 'PUT', body: commands });
    console.log('Successfully registered global commands');
  } catch (error) {
    console.error('Error registering global commands:', error);
    throw error;
  }
}

/**
 * Format a date to a human-readable string
 * 
 * @param {Date|string} date - Date to format
 * @returns {string} - Formatted date string
 */
export function formatDate(date) {
  if (!date) return 'N/A';

  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Invalid date';

  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Validates that the provided Discord token is properly formatted
 * 
 * @returns {boolean} - Whether the token is valid
 */
export function validateDiscordToken() {
  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    console.error('DISCORD_TOKEN is missing in environment variables');
    return false;
  }

  // Discord Bot tokens should have 3 parts separated by periods
  const parts = token.split('.');
  if (parts.length !== 3) {
    console.error('DISCORD_TOKEN has invalid format');
    return false;
  }

  return true;
}

/**
 * Creates a random session ID
 * 
 * @returns {string} - A random session ID
 */
export function createSessionId() {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Sanitizes user input to prevent injection attacks
 * 
 * @param {string} input - User input string
 * @returns {string} - Sanitized string
 */
export function sanitizeInput(input) {
  if (!input) return '';

  // Basic sanitization
  return String(input)
    .replace(/[<>]/g, '') // Remove angle brackets to prevent HTML tags
    .trim();
}

/**
 * Gets a motivational quote for study sessions
 * 
 * @returns {string} - A random motivational quote
 */
export function getMotivationalQuote() {
  const quotes = [
    "The secret of getting ahead is getting started. - Mark Twain",
    "It always seems impossible until it's done. - Nelson Mandela",
    "Don't watch the clock; do what it does. Keep going. - Sam Levenson",
    "Success is not final, failure is not fatal: It is the courage to continue that counts. - Winston Churchill",
    "The future depends on what you do today. - Mahatma Gandhi",
    "You don't have to be great to start, but you have to start to be great. - Zig Ziglar",
    "Believe you can and you're halfway there. - Theodore Roosevelt",
    "The expert in anything was once a beginner. - Helen Hayes",
    "The way to get started is to quit talking and begin doing. - Walt Disney"
  ];

  return quotes[Math.floor(Math.random() * quotes.length)];
}

import pkg from 'pg';
const { Pool } = pkg;

// Configure PostgreSQL connection
const isProduction = process.env.NODE_ENV === 'production';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

/**
 * Saves a completed study session to the database
 * 
 * @param {string} userId - Discord user ID
 * @param {string} taskName - Name of the task
 * @param {number} duration - Duration in seconds
 * @param {string} guildId - Discord server ID
 * @returns {Promise<object>} - The saved session data
 */
export async function saveStudySession(userId, taskName, duration, guildId) {
  // Convert duration from seconds to minutes for database storage
  const durationMinutes = Math.floor(duration / 60);

  const query = `
    INSERT INTO study_sessions (user_id, task_name, duration, guild_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id, completed_at`;

  try {
    const result = await pool.query(query, [userId, taskName, durationMinutes, guildId]);
    return result.rows[0];
  } catch (error) {
    console.error('Error saving study session:', error);
    throw error;
  }
}

/**
 * Gets statistics for a specific user
 * 
 * @param {string} userId - Discord user ID
 * @returns {Promise<object>} - User statistics
 */
export async function getUserStats(userId) {
  const query = `
    SELECT 
      COUNT(*) as total_sessions,
      SUM(duration) as total_minutes,
      MAX(completed_at) as last_session
    FROM study_sessions 
    WHERE user_id = $1`;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows[0] || {
      total_sessions: 0,
      total_minutes: 0,
      last_session: null
    };
  } catch (error) {
    console.error('Error getting user stats:', error);
    throw error;
  }
}

/**
 * Gets leaderboard data for a specific guild (Discord server)
 * 
 * @param {string} guildId - Discord server ID
 * @returns {Promise<Array>} - Array of user statistics
 */
export async function getGuildStats(guildId) {
  const query = `
    SELECT 
      user_id,
      COUNT(*) as sessions_completed,
      SUM(duration) as total_minutes
    FROM study_sessions 
    WHERE guild_id = $1 
    GROUP BY user_id 
    ORDER BY total_minutes DESC 
    LIMIT 10`;

  try {
    const result = await pool.query(query, [guildId]);
    return result.rows;
  } catch (error) {
    console.error('Error getting guild stats:', error);
    throw error;
  }
}

/**
 * Gets heatmap data for a specific user (last 30 days)
 * 
 * @param {string} userId - Discord user ID
 * @returns {Promise<object>} - Heatmap data
 */
export async function getUserHeatmapData(userId) {
  const query = `
    SELECT 
      EXTRACT(DOW FROM completed_at) as day_of_week,
      EXTRACT(HOUR FROM completed_at) as hour,
      SUM(duration) as total_minutes
    FROM study_sessions 
    WHERE user_id = $1
    AND completed_at >= NOW() - INTERVAL '30 days'
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour`;

  try {
    const result = await pool.query(query, [userId]);

    // Convert the raw data into a format suitable for the heatmap
    const heatmapData = {};
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    result.rows.forEach(row => {
      const day = days[Math.floor(row.day_of_week)];
      const hour = Math.floor(row.hour);
      const key = `${day}-${hour}`;
      heatmapData[key] = Math.floor(row.total_minutes);
    });

    return heatmapData;
  } catch (error) {
    console.error('Error getting user heatmap data:', error);
    throw error;
  }
}

/**
 * Gets the top task categories for a user
 * 
 * @param {string} userId - Discord user ID
 * @returns {Promise<Array>} - Array of top tasks
 */
export async function getUserTopTasks(userId) {
  const query = `
    SELECT 
      task_name,
      COUNT(*) as session_count,
      SUM(duration) as total_minutes
    FROM study_sessions 
    WHERE user_id = $1
    GROUP BY task_name
    ORDER BY total_minutes DESC
    LIMIT 5`;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows;
  } catch (error) {
    console.error('Error getting user top tasks:', error);
    throw error;
  }
}

/**
 * Gets a user's daily streak information
 * 
 * @param {string} userId - Discord user ID
 * @returns {Promise<object>} - Streak information
 */
export async function getUserStreak(userId) {
  const query = `
    WITH daily_sessions AS (
      SELECT DISTINCT DATE(completed_at) as study_date
      FROM study_sessions
      WHERE user_id = $1
      ORDER BY study_date DESC
    ),
    
    streak_groups AS (
      SELECT 
        study_date,
        DATE(study_date) - (ROW_NUMBER() OVER (ORDER BY study_date DESC))::integer AS streak_group
      FROM daily_sessions
    )
    
    SELECT 
      COUNT(*) as current_streak,
      MIN(study_date) as streak_start,
      MAX(study_date) as streak_end
    FROM streak_groups
    WHERE streak_group = (
      SELECT streak_group 
      FROM streak_groups 
      WHERE study_date = (SELECT MAX(study_date) FROM daily_sessions)
    )`;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows[0] || { current_streak: 0, streak_start: null, streak_end: null };
  } catch (error) {
    console.error('Error getting user streak:', error);
    throw error;
  }
}

/**
 * Health check for database connection
 * 
 * @returns {Promise<boolean>} - Connection status
 */
export async function checkDatabaseConnection() {
  try {
    const client = await pool.connect();
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection error:', error);
    return false;
  }
}

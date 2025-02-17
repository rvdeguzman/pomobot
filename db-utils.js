import pkg from 'pg';
const { Pool } = pkg;

// Configure SSL based on environment
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Only use SSL in production
  ssl: isProduction ? {
    rejectUnauthorized: false
  } : false
});

export async function saveStudySession(userId, taskName, duration, guildId) {
  const query = `
    INSERT INTO study_sessions (user_id, task_name, duration, guild_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id`;

  try {
    const result = await pool.query(query, [userId, taskName, duration, guildId]);
    return result.rows[0].id;
  } catch (error) {
    console.error('Error saving study session:', error);
    throw error;
  }
}

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
    return result.rows[0];
  } catch (error) {
    console.error('Error getting user stats:', error);
    throw error;
  }
}

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

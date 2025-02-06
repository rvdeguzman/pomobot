-- Drop table if it exists (be careful with this in production!)
DROP TABLE IF EXISTS study_sessions;

-- Create the study sessions table
CREATE TABLE study_sessions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    task_name TEXT NOT NULL,
    duration INTEGER NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    guild_id VARCHAR(255)  -- Discord server ID where the session occurred
);

-- Create indices for better query performance
CREATE INDEX idx_user_sessions ON study_sessions(user_id, completed_at);
CREATE INDEX idx_guild_sessions ON study_sessions(guild_id, completed_at);

-- Verify the table was created
\dt study_sessions;

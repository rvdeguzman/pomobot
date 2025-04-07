-- Clear existing tables if they exist
DROP TABLE IF EXISTS study_sessions;

-- Create the main study sessions table
CREATE TABLE study_sessions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    task_name TEXT NOT NULL,
    duration INTEGER NOT NULL,           -- Duration in minutes
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    guild_id VARCHAR(255) NOT NULL       -- Discord server ID
);

-- Create a table for user settings
CREATE TABLE user_settings (
    user_id VARCHAR(255) PRIMARY KEY,
    default_duration INTEGER DEFAULT 25, -- Default timer duration in minutes
    break_duration INTEGER DEFAULT 5,    -- Default break duration in minutes
    notification_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create a table for session tags
CREATE TABLE session_tags (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES study_sessions(id) ON DELETE CASCADE,
    tag_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indices for better query performance
CREATE INDEX idx_user_sessions ON study_sessions(user_id, completed_at);
CREATE INDEX idx_guild_sessions ON study_sessions(guild_id, completed_at);
CREATE INDEX idx_session_tags ON session_tags(session_id);
CREATE INDEX idx_tag_name ON session_tags(tag_name);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW(); 
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update the timestamp
CREATE TRIGGER update_user_settings_timestamp
BEFORE UPDATE ON user_settings
FOR EACH ROW EXECUTE PROCEDURE update_timestamp();

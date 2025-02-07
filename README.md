# how to run:

1. install packages
`npm i`

2. create postgres database w. schema 
```
# Log into PostgreSQL
psql postgres

# Inside psql, create the database
CREATE DATABASE discord_study_bot;

# Connect to the new database
\c discord_study_bot

# quit

# in zsh:
psql -d discord_study_bot -f schema.sql
```

3. run ngrok
`ngrok http 3000`

4. update discord bot interactions endpoint url:
should look like: 
`https://aebd-107-171-216-129.ngrok-free.app/interactions`

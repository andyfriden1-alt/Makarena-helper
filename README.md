# Tibia Bot

This is a standalone Discord bot for Tibia loot lookups.

It does not depend on `makarena-bot.js`.

By default it builds its sell-price index from Valantis pages:

- [Valantis items](https://valantis.online/about/items)
- [Valantis NPCs](https://valantis.online/about/npcs)

## Files

- `live-bot.js` - the Tibia Discord bot that crawls Valantis live data
- `bot.js` - the original local-data version kept as fallback
- `register.js` - registers the `/sell` slash command
- `valantis-source.js` - crawls and caches Valantis NPC buy prices
- `items.example.json` - optional local override/example item database

## Commands

- Prefix command: `-sell crusader helmet, wand of cosmic energy`
- Slash command: `/sell items: crusader helmet, wand of cosmic energy`

## Environment variables

- `TIBIA_DISCORD_TOKEN` - bot token
- `TIBIA_DISCORD_CLIENT_ID` - application client id
- `TIBIA_DISCORD_GUILD_ID` - optional, registers slash commands faster in one server
- `TIBIA_PREFIX` - optional, default is `-`
- `TIBIA_ITEMS_FILE` - optional, path to a JSON file with local override items
- `TIBIA_CACHE_FILE` - optional, where the Valantis cache JSON is stored
- `TIBIA_CACHE_TTL_MINUTES` - optional, cache lifetime in minutes, default `360`
- `TIBIA_FETCH_TIMEOUT_MS` - optional, HTTP timeout for Valantis fetches

## How pricing works

The live bot reads Valantis NPC pages, parses each NPC `Buys` table, and keeps the best known sell offer per item.

If an item also exists in your local `items.json`, the local version overrides the Valantis result.

## Local override format

Create `tibia-bot/items.json` to override the example file:

```json
{
  "items": [
    {
      "name": "crusader helmet",
      "aliases": ["crus helm"],
      "sellPrice": 6000,
      "sellTo": {
        "name": "Nah'Bob",
        "location": "Darashia"
      }
    }
  ]
}
```

## Run

Register commands:

```powershell
node tibia-bot/register.js
```

Start the bot:

```powershell
node tibia-bot/live-bot.js
```

Or from the Tibia bot folder with npm scripts:

```powershell
npm install
npm run register
npm run start
```

## GitHub and Railway

Recommended repo root: `C:\tibia-bot`

Railway config is stored in `railway.toml` and starts the bot with:

```powershell
node live-bot.js
```

Set these Railway variables before deploying:

- `TIBIA_DISCORD_TOKEN`
- `TIBIA_DISCORD_CLIENT_ID`
- `TIBIA_DISCORD_GUILD_ID` for faster slash-command rollout in one server
- `TIBIA_PREFIX` if you want something other than `-`

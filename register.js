const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.TIBIA_DISCORD_TOKEN || process.env.DISCORD_TOKEN || process.env.TOKEN;
const clientId = process.env.TIBIA_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID;
const guildId = process.env.TIBIA_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

const commands = [
  new SlashCommandBuilder()
    .setName("sell")
    .setDescription("Look up Tibia NPC sell prices for one or more items")
    .addStringOption(option =>
      option
        .setName("items")
        .setDescription("Comma-separated item names")
        .setRequired(true)
    )
    .toJSON()
];

if (!token) {
  console.error("[tibia] Missing token. Set TIBIA_DISCORD_TOKEN or DISCORD_TOKEN.");
  process.exit(1);
}

if (!clientId) {
  console.error("[tibia] Missing client id. Set TIBIA_DISCORD_CLIENT_ID or DISCORD_CLIENT_ID.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

async function registerCommands() {
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`[tibia] Registered ${commands.length} guild command(s) for client ${clientId} in guild ${guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`[tibia] Registered ${commands.length} global command(s) for client ${clientId}.`);
}

registerCommands().catch(error => {
  console.error("[tibia] Failed to register commands:", error);
  process.exit(1);
});

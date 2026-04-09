const fs = require("fs");
const path = require("path");
const {
  Client,
  EmbedBuilder,
  GatewayIntentBits
} = require("discord.js");

const TOKEN = process.env.TIBIA_DISCORD_TOKEN || process.env.DISCORD_TOKEN || process.env.TOKEN;
const PREFIX = process.env.TIBIA_PREFIX || "-";
const DATA_FILE = process.env.TIBIA_ITEMS_FILE || path.join(__dirname, "items.json");
const FALLBACK_DATA_FILE = path.join(__dirname, "items.example.json");

function normalizeItemName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatPrice(price) {
  return `${new Intl.NumberFormat("en-US").format(price)} gp`;
}

function loadItems() {
  const sourcePath = fs.existsSync(DATA_FILE) ? DATA_FILE : FALLBACK_DATA_FILE;
  const raw = fs.readFileSync(sourcePath, "utf8");
  const parsed = JSON.parse(raw);
  const items = new Map();

  for (const entry of parsed.items || []) {
    if (!entry.name || !entry.sellTo?.name || typeof entry.sellPrice !== "number") {
      continue;
    }

    const record = {
      name: entry.name,
      sellPrice: entry.sellPrice,
      sellTo: {
        name: entry.sellTo.name,
        location: entry.sellTo.location || ""
      },
      aliases: Array.isArray(entry.aliases) ? entry.aliases : []
    };

    items.set(normalizeItemName(entry.name), record);

    for (const alias of record.aliases) {
      items.set(normalizeItemName(alias), record);
    }
  }

  return {
    items,
    sourcePath
  };
}

function parseRequestedItems(input) {
  return input
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

function buildLootLookup(itemsInput, database) {
  const grouped = new Map();
  const notFound = [];
  let totalValue = 0;

  for (const requestedName of itemsInput) {
    const item = database.items.get(normalizeItemName(requestedName));

    if (!item) {
      notFound.push(requestedName);
      continue;
    }

    const npcKey = `${item.sellTo.name}|${item.sellTo.location}`;
    const npcGroup = grouped.get(npcKey) || {
      npcName: item.sellTo.name,
      location: item.sellTo.location,
      total: 0,
      entries: []
    };

    npcGroup.entries.push({
      name: item.name,
      price: item.sellPrice
    });
    npcGroup.total += item.sellPrice;
    totalValue += item.sellPrice;
    grouped.set(npcKey, npcGroup);
  }

  return {
    groups: Array.from(grouped.values()).sort((a, b) => a.npcName.localeCompare(b.npcName)),
    notFound,
    totalValue
  };
}

function createLootEmbed(inputText, lookup) {
  const embed = new EmbedBuilder()
    .setTitle("Loot Lookup")
    .setColor(0x6f2cff)
    .setDescription("Here are the prices for the requested items:")
    .setFooter({ text: `Command: ${PREFIX}sell ${inputText}` })
    .setTimestamp();

  if (lookup.groups.length === 0) {
    embed.addFields({
      name: "No matches",
      value: "None of those items were found in the current Tibia item file."
    });
  }

  for (const group of lookup.groups) {
    const lines = group.entries.map(entry => `• 1x ${entry.name} - ${formatPrice(entry.price)}`);
    lines.push(`**Total:** ${formatPrice(group.total)}`);

    embed.addFields({
      name: group.location ? `${group.npcName} (${group.location})` : group.npcName,
      value: lines.join("\n")
    });
  }

  embed.addFields({
    name: "Total loot value",
    value: formatPrice(lookup.totalValue),
    inline: false
  });

  if (lookup.notFound.length > 0) {
    embed.addFields({
      name: "Couldn't find",
      value: lookup.notFound.join(", "),
      inline: false
    });
  }

  return embed;
}

async function handleSellRequest(target, rawInput, database) {
  const items = parseRequestedItems(rawInput);

  if (items.length === 0) {
    const content = `Use \`${PREFIX}sell item one, item two\` or \`/sell\`.`;

    if ("reply" in target) {
      await target.reply({ content, ephemeral: true });
      return;
    }

    await target.reply(content);
    return;
  }

  const lookup = buildLootLookup(items, database);
  const embed = createLootEmbed(rawInput, lookup);

  if ("reply" in target) {
    await target.reply({ embeds: [embed] });
    return;
  }

  await target.reply({ embeds: [embed] });
}

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
];

const client = new Client({ intents });
let database = loadItems();

client.once("ready", readyClient => {
  console.log(`[tibia] Logged in as ${readyClient.user.tag}`);
  console.log(`[tibia] Loaded ${database.items.size} item keys from ${database.sourcePath}`);
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const command = `${PREFIX}sell `;
  if (!message.content.toLowerCase().startsWith(command)) return;

  const rawInput = message.content.slice(command.length).trim();

  try {
    database = loadItems();
    await handleSellRequest(message, rawInput, database);
  } catch (error) {
    console.error("[tibia] Failed to handle message command:", error);
    await message.reply("Something went wrong while looking up those Tibia items.");
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "sell") return;

  try {
    database = loadItems();
    const rawInput = interaction.options.getString("items", true);
    await handleSellRequest(interaction, rawInput, database);
  } catch (error) {
    console.error("[tibia] Failed to handle slash command:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Something went wrong while looking up those Tibia items.",
        ephemeral: true
      }).catch(() => null);
      return;
    }

    await interaction.reply({
      content: "Something went wrong while looking up those Tibia items.",
      ephemeral: true
    }).catch(() => null);
  }
});

client.on("error", error => {
  console.error("[tibia] Client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("[tibia] Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("[tibia] Uncaught exception:", error);
});

if (!TOKEN) {
  console.error("[tibia] Missing token. Set TIBIA_DISCORD_TOKEN or DISCORD_TOKEN.");
  process.exit(1);
}

console.log("[tibia] Starting Tibia loot bot...");
client.login(TOKEN).catch(error => {
  console.error("[tibia] Discord login failed:", error);
  process.exit(1);
});

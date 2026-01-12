const express = require('express');
const { GatewayIntentBits, EmbedBuilder, WebhookClient, ChannelType, ActivityType } = require('discord.js');
const { Client } = require('discord.js');
const path = require('path');
const { Pool } = require('pg');
const os = require('os');
require('dotenv').config();

const app = express();
const port = 5000;

// Groq SDK Configuration
const { Groq } = require('groq-sdk');
const groq = new Groq({
  apiKey: "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"
});

// Replit AI Integration (Legacy)
const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: "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",
  baseURL: "https://api.groq.com/openai/v1",
});

// Custom simple profanity filter
const BANNED_WORDS = ['badword1', 'badword2']; 
function isProfane(text) {
    return BANNED_WORDS.some(word => text.toLowerCase().includes(word));
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const clients = new Map(); // Store multiple clients: token -> client
const prefix = '-';
const DEFAULT_INTERVAL = 25; 
const startTime = Date.now();

// Database Setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guilds (
                guild_id TEXT PRIMARY KEY,
                channel_id TEXT,
                webhook_id TEXT,
                webhook_token TEXT,
                interval_sec INTEGER DEFAULT 20,
                type TEXT DEFAULT '4k',
                images_sent INTEGER DEFAULT 0,
                commands_used INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT FALSE
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_tokens (
                id SERIAL PRIMARY KEY,
                token TEXT UNIQUE NOT NULL,
                owner_ip TEXT
            )
        `);
    } catch (e) {
        console.error("DB Init Error:", e.message);
    }
}

// Helper Functions
async function getGuildData(guildId) {
    const res = await pool.query('SELECT * FROM guilds WHERE guild_id = $1', [guildId]);
    if (res.rows.length === 0) {
        await pool.query('INSERT INTO guilds (guild_id, type, is_active, interval_sec) VALUES ($1, $2, $3, $4)', [guildId, '4k', false, DEFAULT_INTERVAL]);
        return { guild_id: guildId, type: '4k', is_active: false, images_sent: 0, commands_used: 0, interval_sec: DEFAULT_INTERVAL };
    }
    return res.rows[0];
}

async function updateGuildData(guildId, data) {
    await pool.query(
        `UPDATE guilds SET channel_id=$1, webhook_id=$2, webhook_token=$3, interval_sec=$4, type=$5, images_sent=$6, commands_used=$7, is_active=$8 WHERE guild_id=$9`,
        [data.channel_id, data.webhook_id, data.webhook_token, data.interval_sec || DEFAULT_INTERVAL, data.type, data.images_sent, data.commands_used, data.is_active, guildId]
    );
}

const activeIntervals = new Map();

const nsfwCategories = [
    "hass", "hmidriff", "pgif", "4k", "hentai", "holo", "hneko", "neko", 
    "hkitsune", "kemonomimi", "anal", "hanal", "gonewild", "kanna", "ass", 
    "pussy", "thigh", "hthigh", "gah", "coffee", "food", "paizuri", 
    "tentacle", "boobs", "hboobs", "yaoi", "cosplay", "swimsuit", "pantsu", "nakadashi",
    "bj", "erokemo", "feet", "erofeet", "cum", "solo", "femdom", "lewd", "wallpapers"
];

async function getRandomImage(category = "4k") {
    let nbType = nsfwCategories.includes(category) ? category : "4k";
    
    try {
        const fetch = require('node-fetch');
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        ];
        const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

        const res = await fetch(`https://nekobot.xyz/api/image?type=${nbType}`, {
            headers: { 
                'Authorization': '015445535454455354D6',
                'User-Agent': ua,
                'Content-Type': 'application/json'
            }
        });
        
        if (res.status === 429) {
            return { 
                url: "https://i.imgur.com/8nL8u30.png",
                title: "SERVICE BUSY" 
            };
        }
        
        if (!res.ok) throw new Error(`Status ${res.status}`);
        
        const data = await res.json();
        if (data && data.message && typeof data.message === 'string' && data.message.startsWith('http')) {
            if (data.message.includes('8nL8u30')) throw new Error("Broken image");
            return { url: data.message, title: nbType.toUpperCase() };
        }
        throw new Error("Invalid format");
    } catch (e) {
        return { 
            url: "https://i.imgur.com/8nL8u30.png", 
            title: "FALLBACK" 
        };
    }
}

async function sendWebhookImage(guildId){
    try {
        const data = await getGuildData(guildId);
        if (!data.webhook_id || !data.is_active) return;
        
        const result = await getRandomImage(data.type);
        if (result.url.includes('8nL8u30')) return;

        const webhook = new WebhookClient({ id: data.webhook_id, token: data.webhook_token });
        const embed = new EmbedBuilder()
            .setTitle(`Type: ${result.title}`)
            .setImage(result.url)
            .setColor(0x00ffcc)
            .setFooter({text:"Cloud Host | Premium Bot System"})
            .setTimestamp();
        
        await webhook.send({ embeds: [embed] });
        await pool.query('UPDATE guilds SET images_sent = images_sent + 1 WHERE guild_id = $1', [guildId]);
    } catch(e) {
        console.log(`Webhook Error [${guildId}]: ${e.message}`);
    }
}

function startAuto(guildId){
    if(activeIntervals.has(guildId)) stopAuto(guildId);
    getGuildData(guildId).then(data => {
        const intervalSec = Math.max(data.interval_sec || DEFAULT_INTERVAL, 20);
        const interval = intervalSec * 1000;
        const id = setInterval(() => sendWebhookImage(guildId).catch(console.error), interval);
        activeIntervals.set(guildId, id);
    });
    return true;
}

function stopAuto(guildId){
    if(!activeIntervals.has(guildId)) return false;
    clearInterval(activeIntervals.get(guildId));
    activeIntervals.delete(guildId);
    return true;
}

async function startBot(token) {
    if (clients.has(token)) {
        try { clients.get(token).destroy(); } catch (e) {}
    }

    const client = new Client({ 
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildWebhooks,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.GuildMembers
        ]
    });

    client.on('ready', async () => {
        console.log(`${client.user.tag} online!`);
        
        const updateActivity = async () => {
            if (!client.isReady()) return;
            try {
                const statsRes = await pool.query('SELECT SUM(images_sent) as total_images FROM guilds');
                const totalImages = statsRes.rows[0].total_images || 0;
                client.user.setActivity(`${totalImages} Images Delivered`, { type: ActivityType.Watching });
            } catch (err) {
                console.error("Activity update error:", err.message);
            }
        };
        updateActivity();
        const activityInterval = setInterval(updateActivity, 60000);
        client.on('shardDisconnect', () => clearInterval(activityInterval));

        const res = await pool.query('SELECT guild_id FROM guilds WHERE is_active = TRUE');
        for (const row of res.rows) {
            if (client.guilds.cache.has(row.guild_id)) {
                startAuto(row.guild_id);
            }
        }
    });

    client.on('messageCreate', async message => {
        try {
            if(message.author.bot || !message.content.startsWith(prefix)) return;
            if (isProfane(message.content)) return message.reply("Prohibited language.");

            const args = message.content.slice(prefix.length).trim().split(/\s+/);
            const cmd = args.shift().toLowerCase();
            const guildId = message.guild?.id;
            if (!guildId) return;

            let data = await getGuildData(guildId);
            data.commands_used++;
            await updateGuildData(guildId, data);

            if (nsfwCategories.includes(cmd)) {
                const result = await getRandomImage(cmd);
                if (result.url.includes('8nL8u30')) return message.reply("API limit reached. Try later.");
                const embed = new EmbedBuilder().setTitle(`Type: ${result.title}`).setImage(result.url).setColor(0x00ffcc);
                return message.reply({ embeds: [embed] });
            }

            switch(cmd){
                case "status": {
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = uptime % 60;
                    
                    const embed = new EmbedBuilder()
                        .setTitle("System Status")
                        .addFields(
                            { name: "🚀 Uptime", value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
                            { name: "📡 Latency", value: `${client.ws.ping}ms`, inline: true },
                            { name: "📊 Total Images", value: `${data.images_sent}`, inline: true },
                            { name: "⚙️ Memory", value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true },
                            { name: "💻 CPU", value: `${os.loadavg()[0].toFixed(2)}%`, inline: true },
                            { name: "🛡️ Commands", value: `${data.commands_used}`, inline: true }
                        )
                        .setColor(0x00ffcc)
                        .setTimestamp();
                    return message.reply({ embeds: [embed] });
                }
                case "setchannel": {
                    if (!message.member.permissions.has('ManageChannels')) return message.reply("Permission denied.");
                    const channel = message.mentions.channels.first() || message.channel;
                    if (!channel.nsfw) return message.reply("Channel must be NSFW.");
                    
                    const webhooks = await channel.fetchWebhooks();
                    let webhook = webhooks.find(wh => wh.owner.id === client.user.id);
                    if (!webhook) {
                        webhook = await channel.createWebhook({ name: 'CloudPoster', avatar: client.user.displayAvatarURL() });
                    }
                    data.channel_id = channel.id;
                    data.webhook_id = webhook.id;
                    data.webhook_token = webhook.token;
                    data.is_active = true;
                    
                    const intervalArg = parseInt(args[0]);
                    data.interval_sec = (!isNaN(intervalArg) && intervalArg >= 20) ? intervalArg : 20;
                    
                    await updateGuildData(guildId, data);
                    startAuto(guildId);
                    return message.reply(`✅ Started in ${channel} every ${data.interval_sec}s!`);
                }
                case "interval": {
                    if (!message.member.permissions.has('ManageChannels')) return message.reply("Permission denied.");
                    const interval = parseInt(args[0]);
                    if (isNaN(interval) || interval < 20) return message.reply("Min interval 20s.");
                    data.interval_sec = interval;
                    await updateGuildData(guildId, data);
                    if (data.is_active) startAuto(guildId);
                    return message.reply(`✅ Interval: ${interval}s.`);
                }
                case "type": {
                    if (!message.member.permissions.has('ManageChannels')) return message.reply("Permission denied.");
                    const newType = args[0]?.toLowerCase();
                    if (!nsfwCategories.includes(newType)) return message.reply("Invalid type.");
                    data.type = newType;
                    await updateGuildData(guildId, data);
                    return message.reply(`✅ Type: ${newType}.`);
                }
                case "stop": {
                    if (!message.member.permissions.has('ManageChannels')) return message.reply("Permission denied.");
                    data.is_active = false;
                    await updateGuildData(guildId, data);
                    stopAuto(guildId);
                    return message.reply("🛑 Auto-posting stopped.");
                }
                case "categories": {
                    const embed = new EmbedBuilder()
                        .setTitle("Available Categories")
                        .setDescription(nsfwCategories.join(", "))
                        .setColor(0x00ffcc);
                    return message.reply({ embeds: [embed] });
                }
                case "help": {
                    const embed = new EmbedBuilder()
                        .setTitle("Cloud Host | Commands")
                        .setThumbnail(client.user.displayAvatarURL())
                        .setDescription("Industrial-grade NSFW Auto-Poster Management System")
                        .addFields(
                            { name: "🛠️ Setup", value: "`-setchannel [sec]` - Enable auto-post (min 20s)\n`-interval [sec]` - Change frequency\n`-type [cat]` - Change category\n`-stop` - Stop auto-posting" },
                            { name: "📊 Info", value: "`-status` - System health\n`-ping` - Latency check\n`-categories` - List available types" },
                            { name: "🔞 NSFW", value: "Any category name (e.g. `-4k`, `-hentai`) for a single image" }
                        )
                        .setColor(0x00ffcc);
                    return message.reply({ embeds: [embed] });
                }
                case "ping": {
                    return message.reply(`Pong! ${client.ws.ping}ms`);
                }
            }
        } catch (e) {
            console.error("Message Error:", e.message);
        }
    });

    await client.login(token);
    clients.set(token, client);
    return client;
}

// Web Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/status', async (req, res) => {
    try {
        const statsRes = await pool.query('SELECT SUM(images_sent) as total_images FROM guilds');
        const guildCount = await pool.query('SELECT COUNT(*) as count FROM guilds');
        res.json({
            bots_active: clients.size,
            total_images: parseInt(statsRes.rows[0].total_images || 0),
            total_guilds: parseInt(guildCount.rows[0].count || 0),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            cpu: os.loadavg()[0],
            memory: process.memoryUsage().heapUsed,
            ping: Math.floor(Math.random() * 20 + 5) // Mocking cloud latency
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/manage', async (req, res) => {
    const { token, action, value } = req.body;
    if (!token) return res.status(400).json({ error: "Token required" });

    try {
        if (action === 'start') {
            await startBot(token);
            await pool.query('INSERT INTO bot_tokens (token) VALUES ($1) ON CONFLICT (token) DO NOTHING', [token]);
            return res.json({ success: true, message: "Node deployed" });
        }
        
        const client = clients.get(token);
        if (!client) return res.status(404).json({ error: "Node not found" });

        if (action === 'stop') {
            client.destroy();
            clients.delete(token);
            return res.json({ success: true, message: "Node terminated" });
        }

        if (action === 'set_activity') {
            client.user.setActivity(value || "Cloud System", { type: ActivityType.Custom });
            return res.json({ success: true, message: "Activity updated" });
        }

        res.status(400).json({ error: "Invalid action" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/bots', async (req, res) => {
    try {
        const tokens = await pool.query('SELECT token FROM bot_tokens');
        const bots = tokens.rows.map(row => {
            const client = clients.get(row.token);
            return {
                token: row.token,
                active: clients.has(row.token),
                tag: client?.user?.tag || 'Unknown',
                stats: {
                    cpu: (Math.random() * 2 + 0.1).toFixed(2), // Mocking per-bot CPU
                    memory: (Math.random() * 50 + 40).toFixed(2) // Mocking per-bot RAM
                }
            };
        });
        res.json(bots);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const chatHistory = new Map();

app.post('/api/ai/chat', async (req, res) => {
    const { prompt, userId = 'default' } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt required" });
    
    if (!chatHistory.has(userId)) chatHistory.set(userId, []);
    const history = chatHistory.get(userId);
    
    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { 
                    role: 'system', 
                    content: `You are the CLOUD MASTER Prime Intelligence. 
                    Technical Specs of CLOUD MASTER Infrastructure:
                    - Neural Node Uplink: Multi-client Discord bot management system using discord.js v14.
                    - Quantum Dashboard: Real-time telemetry monitoring including CPU load, Heap Memory, Packet Flux (images sent), and Global Latency.
                    - File Repository: Multer-powered storage with the ability to upload, rename, delete, and dynamically SPAWN node.js child processes from uploaded files.
                    - AI Hub: Advanced LLM interface using Groq SDK and Llama 3.3 70B for technical orchestration.
                    - Database: PostgreSQL (Neon-backed) for guild-specific configurations and bot token persistence.
                    - Bot Features: Webhook-based auto-posting (min 25s interval), NSFW category management, and system status commands.
                    Maintain a high-tech, authoritative, yet helpful persona. Use technical terms like 'packet flux', 'node termination', and 'quantum uplink' to describe website features.` 
                },
                ...history,
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 1024,
            top_p: 1,
            stream: false
        });
        
        const reply = response.choices[0].message.content;
        history.push({ role: 'user', content: prompt });
        history.push({ role: 'assistant', content: reply });
        if (history.length > 10) history.splice(0, 2); // Keep last 5 exchanges
        
        res.json({ reply });
    } catch (e) {
        if (!res.headersSent) {
            console.error('Groq AI Error:', e);
            res.status(500).json({ error: e.message });
        }
    }
});

const multer = require('multer');
const fs = require('fs');

// File Upload Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/files', (req, res) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) return res.json([]);
    const files = fs.readdirSync(uploadDir).map(name => ({
        name,
        size: fs.statSync(path.join(uploadDir, name)).size,
        url: `/uploads/${name}`
    }));
    res.json(files);
});

app.post('/api/files/upload', upload.single('file'), (req, res) => {
    res.json({ success: true, message: "File uploaded" });
});

app.post('/api/files/rename', (req, res) => {
    const { oldName, newName } = req.body;
    const uploadDir = path.join(__dirname, 'uploads');
    const oldPath = path.join(uploadDir, oldName);
    const newPath = path.join(uploadDir, newName);
    if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "File not found" });
});

app.post('/api/files/delete', (req, res) => {
    const { name } = req.body;
    const filePath = path.join(__dirname, 'uploads', name);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "File not found" });
});

const { spawn } = require('child_process');
const activeProcesses = new Map();

app.post('/api/files/start', (req, res) => {
    const { name } = req.body;
    const filePath = path.join(__dirname, 'uploads', name);
    
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    if (activeProcesses.has(name)) return res.json({ success: true, message: "Already running" });

    const process = spawn('node', [filePath]);
    activeProcesses.set(name, {
        process,
        logs: [],
        status: 'running'
    });

    process.stdout.on('data', (data) => {
        activeProcesses.get(name).logs.push(`[OUT] ${data.toString()}`);
    });

    process.stderr.on('data', (data) => {
        activeProcesses.get(name).logs.push(`[ERR] ${data.toString()}`);
    });

    process.on('close', (code) => {
        if (activeProcesses.has(name)) {
            activeProcesses.get(name).status = 'stopped';
            activeProcesses.get(name).logs.push(`[SYS] Process exited with code ${code}`);
        }
    });

    res.json({ success: true, message: "Node started" });
});

app.get('/api/files/logs/:name', (req, res) => {
    const { name } = req.params;
    const proc = activeProcesses.get(name);
    if (!proc) return res.json({ logs: [], status: 'not_found' });
    res.json({ logs: proc.logs, status: proc.status });
});

app.post('/api/files/stop', (req, res) => {
    const { name } = req.body;
    const proc = activeProcesses.get(name);
    if (proc && proc.process) {
        proc.process.kill();
        activeProcesses.delete(name);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "Process not found" });
});

initDb().then(() => {
    app.listen(port, '0.0.0.0', () => {
        console.log(`Server active on port ${port}`);
    });
});

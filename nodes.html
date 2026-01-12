const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('--- CLOUD MASTER NODE MANAGER v2.0 ---');
console.log(`Status: ACTIVE | OS: ${os.platform()} | Arch: ${os.arch()}`);
console.log(`Resources: ${Math.round(os.freemem()/1024/1024)}MB Free / ${Math.round(os.totalmem()/1024/1024)}MB Total`);

const tools = {
    scan: () => {
        console.log('[TOOL] Scanning for active node processes...');
        try {
            const ps = execSync('ps aux | grep node | grep -v grep').toString();
            console.log(ps);
        } catch (e) {
            console.log('No other node processes found.');
        }
    },
    disk: () => {
        const uploadsDir = path.join(__dirname, 'uploads');
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            console.log(`[TOOL] Storage: ${files.length} objects in /uploads`);
        }
    },
    network: () => {
        const nets = os.networkInterfaces();
        console.log('[TOOL] Network Uplinks:');
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    console.log(` - ${name}: ${net.address}`);
                }
            }
        }
    }
};

// Execute all tools
Object.values(tools).forEach(tool => tool());

console.log('--- SYSTEM OPTIMIZED ---');

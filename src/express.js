const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

// Store active connections by session ID
let activeConnections = {};

// Serve the login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});

app.post('/terminal', upload.single('privateKey'), (req, res) => {
    const { hostname, username, password } = req.body;
    const privateKeyPath = req.file ? req.file.path : null;

    // Generate a unique session ID
    const sessionId = uuidv4();

    res.redirect(`/terminal?sessionId=${sessionId}`);

    const conn = new Client();
    const sshConfig = {
        host: hostname,
        username: username,
        password: password || undefined,
        privateKey: privateKeyPath ? fs.readFileSync(privateKeyPath) : undefined,
    };

    conn.on('ready', () => {
        console.log(`SSH Connection Ready for session ${sessionId}`);
        io.to(sessionId).emit('data', '\r\n*** SSH CONNECTION ESTABLISHED ***\r\n');

        conn.shell((err, stream) => {
            if (err) {
                io.to(sessionId).emit('data', '\r\n*** SSH SHELL ERROR: ' + err.message + ' ***\r\n');
                return;
            }

            activeConnections[sessionId] = { conn, stream };
            cleanUpPrivateKey(privateKeyPath);

            stream.on('data', (data) => {
                io.to(sessionId).emit('data', data.toString('utf-8'));
            }).on('close', () => {
                console.log(`SSH Stream Closed for session ${sessionId}`);
                conn.end();
                delete activeConnections[sessionId];
            });
        });
    }).on('error', (err) => {
        io.to(sessionId).emit('data', '\r\n*** SSH CONNECTION ERROR: ' + err.message + ' ***\r\n');
        cleanUpPrivateKey(privateKeyPath);
    }).connect(sshConfig);
});

// Serve the terminal page
app.get('/terminal', (req, res) => {
    const sessionId = req.query.sessionId;

    if (!sessionId) {
        return res.status(400).send('Missing session ID');
    }

    res.sendFile(path.join(__dirname, 'public', 'terminal', 'index.html'));
});

// Handle direct connections via URL
app.get('/connect', async (req, res) => {
    const { hostname, username, password, privateKeyUrl } = req.query;

    if (!username || !hostname) {
        return res.status(400).send('Missing required parameters: username and hostname');
    }

    // Generate a unique session ID
    const sessionId = uuidv4();

    let privateKeyPath = null;

    if (privateKeyUrl) {
        const decodedPrivateKeyUrl = Buffer.from(privateKeyUrl, 'base64').toString('utf8');

        try {
            const response = await axios.get(decodedPrivateKeyUrl, { responseType: 'arraybuffer' });
            privateKeyPath = path.join(__dirname, 'uploads', `temp_key_${sessionId}`);
            fs.writeFileSync(privateKeyPath, response.data);
        } catch (error) {
            return res.status(400).send('Failed to download private key');
        }
    }

    const decodedPassword = password ? Buffer.from(password, 'base64').toString('utf8') : undefined;

    res.redirect(`/terminal?sessionId=${sessionId}`);

    const conn = new Client();
    const sshConfig = {
        host: hostname,
        username: username,
        password: decodedPassword,
        privateKey: privateKeyPath ? fs.readFileSync(privateKeyPath) : undefined,
    };

    conn.on('ready', () => {
        console.log(`SSH Connection Ready for session ${sessionId}`);
        io.to(sessionId).emit('data', '\r\n*** SSH CONNECTION ESTABLISHED ***\r\n');

        conn.shell((err, stream) => {
            if (err) {
                io.to(sessionId).emit('data', '\r\n*** SSH SHELL ERROR: ' + err.message + ' ***\r\n');
                return;
            }

            activeConnections[sessionId] = { conn, stream };
            cleanUpPrivateKey(privateKeyPath);

            stream.on('data', (data) => {
                io.to(sessionId).emit('data', data.toString('utf-8'));
            }).on('close', () => {
                console.log(`SSH Stream Closed for session ${sessionId}`);
                conn.end();
                delete activeConnections[sessionId];
            });
        });
    }).on('error', (err) => {
        io.to(sessionId).emit('data', '\r\n*** SSH CONNECTION ERROR: ' + err.message + ' ***\r\n');
        cleanUpPrivateKey(privateKeyPath);
    }).connect(sshConfig);
});

// Serve the terminal page
app.get('/terminal', (req, res) => {
    const sessionId = req.query.sessionId;

    if (!sessionId) {
        return res.status(400).send('Missing session ID');
    }

    res.sendFile(path.join(__dirname, 'public', 'terminal', 'index.html'));
});

// Handle WebSocket connections
io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('join', (sessionId) => {
        socket.join(sessionId);
        console.log(`Client joined session ${sessionId}`);
    });

    socket.on('data', ({ sessionId, data }) => {
        const activeConnection = activeConnections[sessionId];
        if (activeConnection && activeConnection.stream) {
            activeConnection.stream.write(data);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        // Handle cleanup if necessary
    });
});

function cleanUpPrivateKey(privateKeyPath) {
    if (privateKeyPath) {
        fs.unlink(privateKeyPath, (err) => {
            if (err) {
                console.error('Failed to delete private key file:', err);
            } else {
                console.log('Private key file deleted successfully.');
            }
        });
    }
}

server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

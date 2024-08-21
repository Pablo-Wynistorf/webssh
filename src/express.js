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
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3000;


const verifyToken = (req, res, next) => {
    const token = req.query.sessionToken || req.headers['authorization'];
    if (!token) {
        return res.status(403).send('Token is required');
    }

    const bearerToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    jwt.verify(bearerToken, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send('Invalid Token');
        }
        req.sessionId = decoded.sessionId;
        req.sessionToken = bearerToken;
        next();
    });
};


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));


const upload = multer({ dest: 'uploads/' });


let activeConnections = {};
let clientCounts = {};
let disconnectTimers = {};


// Serve the login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});


// Handle SSH terminal connection
app.post('/terminal', upload.single('privateKey'), (req, res) => {
    const { hostname, username, password } = req.body;
    const privateKeyPath = req.file ? req.file.path : null;

    const sessionId = uuidv4();
    const sessionToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '1h' });

    res.redirect(`/terminal?sessionToken=${sessionToken}`);

    const sshConfig = {
        host: hostname,
        username: username,
        password: password || undefined,
        privateKey: privateKeyPath ? fs.readFileSync(privateKeyPath) : undefined,
    };

    createSSHConnection(sessionId, sshConfig, privateKeyPath);
});


// Serve the terminal page if token is valid
app.get('/terminal', verifyToken, (req, res) => {
    const { sessionId } = req;

    if (!sessionId) {
        return res.status(400).send('Invalid session token');
    }

    if (!activeConnections[sessionId]) {
        return res.status(403).send('Session has been terminated');
    }

    res.sendFile(path.join(__dirname, 'public', 'terminal', 'index.html'));
});


// Handle SSH connection with query parameters
app.get('/connect', async (req, res) => {
    const { hostname, username, password, privateKeyUrl } = req.query;

    if (!username || !hostname) {
        return res.status(400).send('Missing required parameters: username and hostname');
    }

    const sessionId = uuidv4();
    const sessionToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '1h' });

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

    res.redirect(`/terminal?sessionToken=${sessionToken}`);

    const sshConfig = {
        host: hostname,
        username: username,
        password: decodedPassword,
        privateKey: privateKeyPath ? fs.readFileSync(privateKeyPath) : undefined,
    };

    createSSHConnection(sessionId, sshConfig, privateKeyPath);
});


// Socket.IO connection handling
io.on('connection', (socket) => {
    let currentSessionId = null;

    socket.on('join', ({ sessionToken }) => {
        if (!sessionToken) {
            socket.emit('error', 'The session token is required');
            socket.disconnect(true);
            return;
        }

        jwt.verify(sessionToken, JWT_SECRET, (err, decoded) => {
            if (err || !decoded.sessionId) {
                socket.emit('error', 'Invalid session token');
                socket.disconnect(true);
                return;
            }

            currentSessionId = decoded.sessionId;

            if (!clientCounts[currentSessionId]) {
                clientCounts[currentSessionId] = 1;
            } else {
                clientCounts[currentSessionId] += 1;
            }

            socket.join(currentSessionId);

            if (disconnectTimers[currentSessionId]) {
                clearTimeout(disconnectTimers[currentSessionId]);
                delete disconnectTimers[currentSessionId];
            }
            socket.emit('requestTerminalSize');
        });
    });

    socket.on('data', ({ data }) => {
        if (currentSessionId && activeConnections[currentSessionId]) {
            const { stream } = activeConnections[currentSessionId];
            if (stream && stream.writable) {
                stream.write(data);
            } else {
                console.error(`Stream for session ${currentSessionId} is not writable.`);
            }
        } else {
            console.error(`No active connection for session ${currentSessionId}.`);
        }
    });

    socket.on('resize', ({ rows, cols }) => {
        if (currentSessionId && activeConnections[currentSessionId]) {
            const { stream } = activeConnections[currentSessionId];
            if (stream && stream.setWindow) {
                stream.setWindow(rows, cols, 0, 0);
            } else {
                return;
            }
        } else {
            console.error(`No active connection for session ${currentSessionId}.`);
        }
    });

    socket.on('disconnect', () => {
        if (currentSessionId) {
            clientCounts[currentSessionId] = Math.max((clientCounts[currentSessionId] || 1) - 1, 0);

            if (clientCounts[currentSessionId] === 0) {
                disconnectTimers[currentSessionId] = setTimeout(() => {
                    endSession(currentSessionId);
                }, 60000);
            }
        }
    });
});


function createSSHConnection(sessionId, sshConfig, privateKeyPath) {
    const conn = new Client();

    conn.on('ready', () => {
        io.to(sessionId).emit('data', '\r\n*** SSH CONNECTION ESTABLISHED ***\r\n');

        conn.shell((err, stream) => {
            if (err) {
                io.to(sessionId).emit('data', '\r\n*** SSH SHELL ERROR: ' + err.message + ' ***\r\n');
                cleanUpPrivateKey(privateKeyPath);
                endSession(sessionId);
                return;
            }

            activeConnections[sessionId] = { conn, stream };
            clientCounts[sessionId] = 1;

            cleanUpPrivateKey(privateKeyPath);

            stream.on('data', (data) => {
                io.to(sessionId).emit('data', data.toString('utf-8'));
            }).on('close', () => {
                endSession(sessionId);
            });

            io.to(sessionId).emit('requestTerminalSize');
        });
    }).on('end', () => {
        console.log(`SSH connection ended for session ${sessionId}`);
        endSession(sessionId);
    }).on('error', (err) => {
        io.to(sessionId).emit('data', '\r\n*** SSH CONNECTION ERROR: ' + err.message + ' ***\r\n');
        endSession(sessionId);
    }).connect(sshConfig);
}


function endSession(sessionId) {
    if (activeConnections[sessionId]) {
        const { conn } = activeConnections[sessionId];
        conn.end();
        delete activeConnections[sessionId];
        delete clientCounts[sessionId];
        console.log(`Session ${sessionId} terminated.`);
    }
}


function cleanUpPrivateKey(privateKeyPath) {
    if (privateKeyPath) {
        fs.unlink(privateKeyPath, (err) => {
            if (err) console.error(`Failed to delete private key file: ${err.message}`);
        });
    }
}


server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

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

const jwtSecret = process.env.JWT_SECRET;
const port = process.env.PORT || 3000;

const verifyToken = (req, res, next) => {
    const token = req.query.sessionToken || req.headers['authorization'];
    if (!token) {
        return res.status(403).send('Token is required');
    }

    const bearerToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    jwt.verify(bearerToken, jwtSecret, (err, decoded) => {
        if (err) {
            return res.status(401).send('Invalid Token');
        }
        req.sessionId = decoded.sessionId;
        next();
    });
};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

let activeConnections = {};
let clientCounts = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});

app.post('/terminal', upload.single('privateKey'), (req, res) => {
    const { hostname, username, password } = req.body;
    const privateKeyPath = req.file ? req.file.path : null;

    const sessionId = uuidv4();
    const token = jwt.sign({ sessionId }, jwtSecret, { expiresIn: '1h' });

    res.redirect(`/terminal?sessionId=${sessionId}&sessionToken=${token}`);

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
                cleanUpPrivateKey(privateKeyPath); 
                return;
            }

            activeConnections[sessionId] = { conn, stream };
            clientCounts[sessionId] = 0;

            cleanUpPrivateKey(privateKeyPath);

            stream.on('data', (data) => {
                io.to(sessionId).emit('data', data.toString('utf-8'));
            }).on('close', () => {
                console.log(`Client disconnected for session ${sessionId}`);
            });
        });
    }).on('end', () => {
        console.log(`Client disconnected for session ${sessionId}`);
    }).on('error', (err) => {
        io.to(sessionId).emit('data', '\r\n*** SSH CONNECTION ERROR: ' + err.message + ' ***\r\n');
        endSession(sessionId); 
    }).connect(sshConfig);
});

app.get('/terminal', verifyToken, (req, res) => {
    const { sessionId } = req;

    if (!sessionId) {
        return res.status(400).send('Invalid session ID');
    }

    if (!activeConnections[sessionId]) {
        return res.status(403).send('Session has been terminated');
    }

    res.sendFile(path.join(__dirname, 'public', 'terminal', 'index.html'));
});

app.get('/connect', async (req, res) => {
    const { hostname, username, password, privateKeyUrl } = req.query;

    if (!username || !hostname) {
        return res.status(400).send('Missing required parameters: username and hostname');
    }

    const sessionId = uuidv4();
    const token = jwt.sign({ sessionId }, jwtSecret, { expiresIn: '1h' });

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

    res.redirect(`/terminal?sessionId=${sessionId}&sessionToken=${token}`);

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
                cleanUpPrivateKey(privateKeyPath);
                return;
            }

            activeConnections[sessionId] = { conn, stream };
            clientCounts[sessionId] = 0;

            cleanUpPrivateKey(privateKeyPath);

            stream.on('data', (data) => {
                io.to(sessionId).emit('data', data.toString('utf-8'));
            }).on('close', () => {
                console.log(`Client disconnected for session ${sessionId}`);
            });
        });
    }).on('end', () => {
        console.log(`Client disconnected for session ${sessionId}`);
    }).on('error', (err) => {
        io.to(sessionId).emit('data', '\r\n*** SSH CONNECTION ERROR: ' + err.message + ' ***\r\n');
        endSession(sessionId);
    }).connect(sshConfig);
});

io.on('connection', (socket) => {
    console.log('Client connected');

    // Track the session ID for the socket
    let currentSessionId = null;

    socket.on('join', (sessionId) => {
        socket.join(sessionId);
        currentSessionId = sessionId; // Track session ID in a variable
        console.log(`Client joined session ${sessionId}`);

        if (clientCounts[sessionId] === undefined) {
            clientCounts[sessionId] = 0;
        }

        clientCounts[sessionId] += 1;
    });

    socket.on('data', ({ sessionId, data }) => {
        const activeConnection = activeConnections[sessionId];
        if (activeConnection && activeConnection.stream) {
            activeConnection.stream.write(data);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');

        if (currentSessionId) {
            clientCounts[currentSessionId] = (clientCounts[currentSessionId] || 0) - 1;

            if (clientCounts[currentSessionId] <= 0) {
                console.log(`No more clients for session ${currentSessionId}. Closing SSH connection.`);
                endSession(currentSessionId);
                delete clientCounts[currentSessionId];
            }
        }
    });
});



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

const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIO = require('socket.io');
const url = require('url');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public'));
});

let activeConnection = null;

io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('data', (data) => {
        if (activeConnection && activeConnection.stream) {
            activeConnection.stream.write(data);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        if (activeConnection) {
            activeConnection.conn.end();
        }
    });
});

app.post('/terminal', upload.single('privateKey'), (req, res) => {
    const { hostname, username, password } = req.body;
    const privateKeyPath = req.file ? req.file.path : null;

    res.sendFile(path.join(__dirname, 'public', 'terminal.html'));

    const conn = new Client();
    const sshConfig = {
        host: hostname,
        username: username,
        password: password,
        privateKey: privateKeyPath ? fs.readFileSync(privateKeyPath) : undefined,
    };

    conn.on('ready', () => {
        console.log('SSH Connection Ready');
        io.emit('data', '\r\n*** SSH CONNECTION ESTABLISHED ***\r\n');

        conn.shell((err, stream) => {
            if (err) {
                io.emit('data', '\r\n*** SSH SHELL ERROR: ' + err.message + ' ***\r\n');
                return;
            }

            activeConnection = { conn, stream };
            if (privateKeyPath) {
                fs.unlink(privateKeyPath, (err) => {
                    if (err) {
                        console.error('Failed to delete private key file:', err);
                    } else {
                        console.log('Private key file deleted successfully.');
                    }
                });
            }

            stream.on('data', (data) => {
                io.emit('data', data.toString('utf-8'));
            }).on('close', () => {
                console.log('SSH Stream Closed');
                conn.end();
                activeConnection = null;
            });

        });
    }).on('error', (err) => {
        io.emit('data', '\r\n*** SSH CONNECTION ERROR: ' + err.message + ' ***\r\n');
    }).connect(sshConfig);
});

app.get('/connect', async (req, res) => {
    const query = url.parse(req.url, true).query;
    const { hostname, username, password, privateKeyUrl } = query;

    let privateKeyPath = null;

    if (privateKeyUrl) {
        const decoded_privateKeyUrl = Buffer.from(privateKeyUrl, 'base64').toString('utf8');
        
        try {
            const response = await axios.get(decoded_privateKeyUrl, { responseType: 'arraybuffer' });
            privateKeyPath = path.join(__dirname, 'uploads', 'temp_key');
            fs.writeFileSync(privateKeyPath, response.data);
        } catch (error) {
            return res.status(400).send('Failed to download private key');
        }
    }

    if (!username || !hostname) {
        return res.status(400).send('Missing required parameters: username and hostname');
    }

    const decoded_password = password ? Buffer.from(password, 'base64').toString('utf8') : undefined;

    res.sendFile(path.join(__dirname, 'public', 'terminal.html'));

    const conn = new Client();
    const sshConfig = {
        host: hostname,
        username: username,
        password: decoded_password,
        privateKey: privateKeyPath ? fs.readFileSync(privateKeyPath) : undefined,
    };

    conn.on('ready', () => {
        console.log('SSH Connection Ready');
        io.emit('data', '\r\n*** SSH CONNECTION ESTABLISHED ***\r\n');

        conn.shell((err, stream) => {
            if (err) {
                io.emit('data', '\r\n*** SSH SHELL ERROR: ' + err.message + ' ***\r\n');
                return;
            }

            activeConnection = { conn, stream };

            if (privateKeyPath) {
                fs.unlink(privateKeyPath, (err) => {
                    if (err) {
                        console.error('Failed to delete private key file:', err);
                    } else {
                        console.log('Private key file deleted successfully.');
                    }
                });
            }

            stream.on('data', (data) => {
                io.emit('data', data.toString('utf-8'));
            }).on('close', () => {
                console.log('SSH Stream Closed');
                conn.end();
                activeConnection = null;
            });

        });
    }).on('error', (err) => {
        io.emit('data', '\r\n*** SSH CONNECTION ERROR: ' + err.message + ' ***\r\n');
    }).connect(sshConfig);
});

server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

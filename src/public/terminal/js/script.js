document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionToken = urlParams.get('sessionToken');

    if (!sessionToken) {
        alert('The session token is required!');
        throw new Error('Session token is missing');
    }

    const socket = io();

    socket.emit('join', { sessionToken });

    const terminalContainer = document.getElementById('terminal-container');
    const terminal = new Terminal({
        fontSize: 14,
        cursorBlink: true
    });
    const fitAddon = new FitAddon.FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainer);

    function fitAndSendTerminalSize() {
        fitAddon.fit();
        const { rows, cols } = terminal;
        socket.emit('resize', { sessionToken, rows, cols });
    }

    window.addEventListener('resize', fitAndSendTerminalSize);

    terminal.onData((data) => {
        socket.emit('data', { sessionToken, data });
    });

    socket.on('data', (message) => {
        terminal.write(message);
    });

    socket.on('requestTerminalSize', () => {
        fitAndSendTerminalSize();
    });

    fitAndSendTerminalSize();
});

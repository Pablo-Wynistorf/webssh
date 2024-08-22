# README

## Overview

This application provides a web-based SSH terminal interface using Node.js and Express. It supports file uploads for private keys, generates session tokens, and handles SSH connections with Socket.IO for real-time communication.

## Use the application

You can either self host this application for maximum privacy, or use our app hosted at: https://ssh.onedns.ch
We guarantee that none of the used ssh key or password data is stored. (Just used to connect)

## Features

- **Login Page**: Access the terminal application via a login page.
- **SSH Terminal**: Connect to remote servers using SSH and interact through a web-based terminal.
- **Session Management**: Manage sessions with JWT tokens.
- **Socket.IO Integration**: Real-time interaction between the client and server.

## Installation

1. **Clone the Repository**

   ```bash
   git clone https://github.com/Pablo-Wynistorf/webssh.git
   cd webssh
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Environment Configuration**

   Create a `.env` file in the root directory and add the following environment variables:

   ```env
   JWT_SECRET=your_jwt_secret
   PORT=3000
   ```

   Replace `your_jwt_secret` with a strong, secret key for JWT encoding.

4. **Run the Application**

   ```bash
   cd src
   node express.js
   ```

   The server will start on port 3000 by default. Access the application at `http://localhost:3000`.

## Usage

1. **Login Page**

   Navigate to the root URL (`/`) to access the login page.

2. **SSH Terminal**

   - **POST /terminal**: Submit SSH connection details and optional private key file to start an SSH session.
   - **GET /terminal**: Access the terminal page if you have a valid session token.

3. **Connect with Query Parameters**

   - **GET /connect**: Connect to an SSH server using query parameters. Example URL: `/connect?hostname=example.com&username=user&password=base64encodedpassword`.
   - **GET /connect**: Connect to an SSH server using query parameters. Example URL: `/connect?hostname=example.com&username=user&privateKeyUrl=base64encodedurl`.

4. **WebSocket Communication**

   - **Socket.IO Events**:
     - `join`: Join a session with a session token.
     - `data`: Send data to the SSH stream.
     - `resize`: Resize the terminal.
     - `disconnect`: Handle disconnection events.

## Contributing

Feel free to submit issues or pull requests. Contributions are welcome!

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

# SSH Connection Manual

## Connecting via `/connect` Endpoint

To initiate an SSH connection through the `/connect` endpoint, follow these steps:

### 1. Prepare Connection Details

You need the following parameters:

- **hostname**: The SSH server's hostname or IP address.
- **username**: The SSH username.
- **password**: The SSH password, base64-encoded (optional).
- **privateKeyUrl**: The download URL of the private key, base64-encoded (As download url we recommend using a signed s3 get-object request with a max validity of a couple seconds))

### 2. Craft the Request URL

Format the URL with the query parameters:

```
GET /connect?hostname=example.com&username=user&password=base64encodedpassword
```
```
GET /connect?hostname=example.com&username=user&privateKeyUrl=base64encodedurl
```

Example:

```
GET /connect?hostname=192.168.1.100&username=admin&password=cGFzc3dvcmQ=
```
```
GET /connect?hostname=192.168.1.100&username=admin&privateKeyUrl=aHR0cDovL2V4YW1wbGUuY29tL3ByaXZhdGVrZXk=
```

### 3. Access the Terminal

After sending the request, you will be redirected to the terminal page with a session token. Open the terminal page (`/terminal`) using the provided token.

### 4. WebSocket Communication

Once connected, you can use the browser to manage your ssh instance 

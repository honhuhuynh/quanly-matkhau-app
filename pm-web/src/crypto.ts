export interface EncryptedPayload {
    salt: string;       // Base64
    iv: string;         // Base64
    data: string;       // Base64 (Encrypted Vault JSON)
    hint: string;       // Plaintext password hint
}

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const ITERATIONS = 100000;

function bufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: ENCRYPTION_ALGORITHM, length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptVault(vaultJson: string, password: string, hint: string = ''): Promise<string> {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);

    const enc = new TextEncoder();
    const encryptedData = await window.crypto.subtle.encrypt(
        { name: ENCRYPTION_ALGORITHM, iv: iv },
        key,
        enc.encode(vaultJson)
    );

    const payload: EncryptedPayload = {
        salt: bufferToBase64(salt),
        iv: bufferToBase64(iv),
        data: bufferToBase64(encryptedData),
        hint: hint
    };

    return JSON.stringify(payload);
}

export async function decryptVault(encryptedPayloadString: string, password: string): Promise<string> {
    const payload: EncryptedPayload = JSON.parse(encryptedPayloadString);
    
    const salt = new Uint8Array(base64ToBuffer(payload.salt));
    const iv = new Uint8Array(base64ToBuffer(payload.iv));
    const encryptedData = base64ToBuffer(payload.data);

    const key = await deriveKey(password, salt);

    try {
        const decryptedData = await window.crypto.subtle.decrypt(
            { name: ENCRYPTION_ALGORITHM, iv: iv },
            key,
            encryptedData
        );
        const dec = new TextDecoder();
        return dec.decode(decryptedData);
    } catch (e) {
        throw new Error("Sai mật khẩu hoặc dữ liệu bị hỏng (Decryption Failed)");
    }
}

export function extractHint(encryptedPayloadString: string): string {
    try {
        const payload: EncryptedPayload = JSON.parse(encryptedPayloadString);
        return payload.hint || '';
    } catch {
        return '';
    }
}

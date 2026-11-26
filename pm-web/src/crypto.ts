export interface EncryptedPayload {
    salt: string;       // Base64
    iv: string;         // Base64
    data: string;       // Base64 (Encrypted Vault JSON)
    hint: string;       // Plaintext password hint
}

export interface PasswordGeneratorOptions {
    length?: number;
    uppercase?: boolean;
    lowercase?: boolean;
    numbers?: boolean;
    symbols?: boolean;
}

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const ITERATIONS = 100000;

function bufferToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await globalThis.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    return globalThis.crypto.subtle.deriveKey(
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
    const salt = new Uint8Array(new ArrayBuffer(16));
    const iv = new Uint8Array(new ArrayBuffer(12));
    globalThis.crypto.getRandomValues(salt);
    globalThis.crypto.getRandomValues(iv);
    const key = await deriveKey(password, salt);

    const enc = new TextEncoder();
    const encryptedData = await globalThis.crypto.subtle.encrypt(
        { name: ENCRYPTION_ALGORITHM, iv: iv },
        key,
        enc.encode(vaultJson)
    );

    const payload: EncryptedPayload = {
        salt: bufferToBase64(salt),
        iv: bufferToBase64(iv),
        data: bufferToBase64(new Uint8Array(encryptedData)),
        hint: hint
    };

    return JSON.stringify(payload);
}

export async function decryptVault(encryptedPayloadString: string, password: string): Promise<string> {
    const payload: EncryptedPayload = JSON.parse(encryptedPayloadString);

    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const encryptedData = base64ToBytes(payload.data);

    const key = await deriveKey(password, salt);

    try {
        const decryptedData = await globalThis.crypto.subtle.decrypt(
            { name: ENCRYPTION_ALGORITHM, iv: iv },
            key,
            encryptedData
        );
        const dec = new TextDecoder();
        return dec.decode(decryptedData);
    } catch {
        throw new Error('Sai mật khẩu hoặc dữ liệu bị hỏng (Decryption Failed)');
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

function secureRandomIndex(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    const buf = new Uint32Array(1);
    while (true) {
        globalThis.crypto.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % maxExclusive;
    }
}

export function generateStrongPassword(options: PasswordGeneratorOptions = {}): string {
    const length = Math.max(8, Math.min(64, options.length ?? 16));
    const useUpper = options.uppercase ?? true;
    const useLower = options.lowercase ?? true;
    const useNumbers = options.numbers ?? true;
    const useSymbols = options.symbols ?? true;

    const sets: string[] = [];
    if (useUpper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
    if (useLower) sets.push('abcdefghijkmnopqrstuvwxyz');
    if (useNumbers) sets.push('23456789');
    if (useSymbols) sets.push('!@#$%^&*-_=+?');

    if (sets.length === 0) {
        sets.push('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    }

    const fullCharset = sets.join('');
    const chars: string[] = [];

    // Bảo đảm có ít nhất 1 ký tự từ mỗi bộ được chọn
    for (const s of sets) {
        if (chars.length < length) {
            chars.push(s[secureRandomIndex(s.length)]);
        }
    }

    while (chars.length < length) {
        chars.push(fullCharset[secureRandomIndex(fullCharset.length)]);
    }

    // Fisher-Yates shuffle bằng CSPRNG
    for (let i = chars.length - 1; i > 0; i--) {
        const j = secureRandomIndex(i + 1);
        const tmp = chars[i];
        chars[i] = chars[j];
        chars[j] = tmp;
    }

    return chars.join('');
}

export function isWeakPassword(pwd: string): boolean {
    if (!pwd) return false;
    if (pwd.length < 8) return true;
    let classes = 0;
    if (/[a-z]/.test(pwd)) classes++;
    if (/[A-Z]/.test(pwd)) classes++;
    if (/[0-9]/.test(pwd)) classes++;
    if (/[^A-Za-z0-9]/.test(pwd)) classes++;
    return classes < 2;
}

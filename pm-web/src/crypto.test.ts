import { describe, it, expect } from 'vitest';
import { generateSecretKey, deriveKey, encryptData, decryptData, base64ToBuffer } from './crypto';

describe('Crypto Module', () => {
    it('should generate a 128-bit (16-byte) Secret Key', () => {
        const secretKey = generateSecretKey();
        const buffer = base64ToBuffer(secretKey);
        expect(buffer.length).toBe(16);
    });

    it('should correctly encrypt and decrypt data with the same password and secret key', async () => {
        const password = 'SuperSecretPassword123!';
        const secretKey = generateSecretKey();
        
        const key = await deriveKey(password, secretKey);
        
        const plaintext = JSON.stringify({ myPass: '123456' });
        const encrypted = await encryptData(plaintext, key);
        
        expect(encrypted.ciphertext).toBeDefined();
        expect(encrypted.iv).toBeDefined();
        expect(encrypted.ciphertext).not.toBe(plaintext);
        
        const decrypted = await decryptData(encrypted, key);
        expect(decrypted).toBe(plaintext);
    });

    it('should fail to decrypt with wrong password', async () => {
        const password = 'SuperSecretPassword123!';
        const secretKey = generateSecretKey();
        
        const key = await deriveKey(password, secretKey);
        const encrypted = await encryptData('test data', key);
        
        const wrongKey = await deriveKey('WrongPassword!', secretKey);
        
        await expect(decryptData(encrypted, wrongKey)).rejects.toThrow();
    });

    it('should fail to decrypt if ciphertext is tampered', async () => {
        const password = 'SuperSecretPassword123!';
        const secretKey = generateSecretKey();
        const key = await deriveKey(password, secretKey);
        const encrypted = await encryptData('test data', key);
        
        // Tamper with ciphertext by modifying base64 string slightly (e.g. replacing 'A' with 'B')
        const tamperedCiphertext = encrypted.ciphertext.replace(/[A-Z]/, (c) => String.fromCharCode((c.charCodeAt(0) + 1) % 26 + 65));
        
        await expect(decryptData({ ...encrypted, ciphertext: tamperedCiphertext }, key)).rejects.toThrow();
    });

    it('should generate a new IV for every encryption', async () => {
        const password = 'SuperSecretPassword123!';
        const secretKey = generateSecretKey();
        const key = await deriveKey(password, secretKey);
        
        const encrypted1 = await encryptData('test data', key);
        const encrypted2 = await encryptData('test data', key);
        
        expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });
});

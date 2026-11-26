import { describe, it, expect } from 'vitest';
import { encryptVault, decryptVault, extractHint, generateStrongPassword, isWeakPassword } from './crypto';

describe('Crypto & Password Generator Module', () => {
    it('should encrypt and decrypt vault payload preserving hint', async () => {
        const password = 'MasterPassword123!';
        const plaintext = JSON.stringify({ version: 1, items: [{ id: '1', name: 'Gmail HP' }] });

        const encryptedStr = await encryptVault(plaintext, password, 'Ten thu cung');
        expect(extractHint(encryptedStr)).toBe('Ten thu cung');
        expect(encryptedStr).not.toContain('Gmail HP');

        const decrypted = await decryptVault(encryptedStr, password);
        expect(decrypted).toBe(plaintext);
    });

    it('should fail to decrypt with wrong password', async () => {
        const encryptedStr = await encryptVault('{"version":1,"items":[]}', 'RightPass123!', '');
        await expect(decryptVault(encryptedStr, 'WrongPass123!')).rejects.toThrow();
    });

    it('should fail to decrypt when ciphertext is tampered', async () => {
        const encryptedStr = await encryptVault('secret payload', 'RightPass123!', '');
        const parsed = JSON.parse(encryptedStr);
        parsed.data = 'AAAA' + parsed.data.slice(4);
        await expect(decryptVault(JSON.stringify(parsed), 'RightPass123!')).rejects.toThrow();
    });

    it('should generate unique IV on each encryption', async () => {
        const e1 = JSON.parse(await encryptVault('same', 'Pass123!', ''));
        const e2 = JSON.parse(await encryptVault('same', 'Pass123!', ''));
        expect(e1.iv).not.toBe(e2.iv);
        expect(e1.salt).not.toBe(e2.salt);
    });

    it('should generate strong random passwords matching policy', () => {
        const p = generateStrongPassword({ length: 18 });
        expect(p.length).toBe(18);
        expect(isWeakPassword(p)).toBe(false);
        expect(isWeakPassword('123456')).toBe(true);
    });
});

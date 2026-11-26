export interface GithubConfig {
    repo: string;
    token: string;
}

export type StorageMode = 'github' | 'offline';
export type SyncState = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

const OFFLINE_VAULT_PREFIX = 'pm_offline_vault_';
const shaCache = new Map<string, string>();
let syncListener: ((state: SyncState, detail?: string) => void) | null = null;

export function setSyncStatusListener(listener: ((state: SyncState, detail?: string) => void) | null): void {
    syncListener = listener;
}

export function notifySyncState(state: SyncState, detail?: string): void {
    syncListener?.(state, detail);
}

export function getGithubConfig(): GithubConfig | null {
    const repo = localStorage.getItem('gh_repo')?.trim() || '';
    const token = localStorage.getItem('gh_token')?.trim() || '';
    if (repo && token) return { repo, token };
    return null;
}

export function saveGithubConfig(repo: string, token: string): void {
    if (!repo && !token) {
        localStorage.removeItem('gh_repo');
        localStorage.removeItem('gh_token');
        return;
    }
    localStorage.setItem('gh_repo', repo);
    localStorage.setItem('gh_token', token);
}

export function getActiveStorageMode(): StorageMode {
    return getGithubConfig() ? 'github' : 'offline';
}

export function clearCachedSha(vaultName?: string): void {
    if (vaultName) shaCache.delete(vaultName);
    else shaCache.clear();
}

function utf8ToBase64(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function base64ToUtf8(b64: string): string {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

export function listOfflineVaults(): string[] {
    const vaults: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(OFFLINE_VAULT_PREFIX)) {
            const name = key.slice(OFFLINE_VAULT_PREFIX.length);
            if (name && !vaults.includes(name)) vaults.push(name);
        }
    }
    return vaults.sort();
}

export async function listAvailableVaults(): Promise<string[]> {
    const vaults = new Set<string>(listOfflineVaults());
    const config = getGithubConfig();
    if (!config) return Array.from(vaults);

    try {
        const res = await fetch(`https://api.github.com/repos/${config.repo}/contents?_t=${Date.now()}`, {
            headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github+json'
            }
        });
        if (res.ok) {
            const files = await res.json();
            if (Array.isArray(files)) {
                for (const f of files) {
                    if (typeof f.name === 'string' && f.name.startsWith('vault_') && f.name.endsWith('.enc')) {
                        const vaultName = f.name.slice(6, -4);
                        if (vaultName) vaults.add(vaultName);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Github API Error:', e);
    }
    return Array.from(vaults);
}

export async function fetchVaultData(vaultName: string): Promise<string | null> {
    const config = getGithubConfig();
    if (!config) {
        return localStorage.getItem(`${OFFLINE_VAULT_PREFIX}${vaultName}`);
    }

    try {
        const path = `vault_${encodeURIComponent(vaultName)}.enc`;
        const res = await fetch(`https://api.github.com/repos/${config.repo}/contents/${path}?_t=${Date.now()}`, {
            headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github+json'
            }
        });
        if (res.status === 404) {
            shaCache.delete(vaultName);
            return null;
        }
        if (!res.ok) throw new Error('Lỗi kết nối GitHub (Kiểm tra lại Repo hoặc Token)');

        const data = await res.json();
        if (data.sha) {
            shaCache.set(vaultName, data.sha);
        }
        const b64 = String(data.content || '').replace(/\n/g, '');
        const content = base64ToUtf8(b64);
        localStorage.setItem(`${OFFLINE_VAULT_PREFIX}${vaultName}`, content);
        return content;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Lỗi lấy dữ liệu từ GitHub';
        throw new Error(msg);
    }
}

export async function saveVaultData(vaultName: string, content: string): Promise<void> {
    const config = getGithubConfig();
    localStorage.setItem(`${OFFLINE_VAULT_PREFIX}${vaultName}`, content);

    if (!config) {
        notifySyncState('offline', 'Đã lưu cục bộ (Chế độ Offline)');
        return;
    }

    notifySyncState('saving', 'Đang đồng bộ lên GitHub...');
    const path = `vault_${encodeURIComponent(vaultName)}.enc`;

    const doPut = async (sha?: string) => {
        const body: Record<string, string> = {
            message: `[Auto] Update vault: ${vaultName}`,
            content: utf8ToBase64(content)
        };
        if (sha) body.sha = sha;

        return fetch(`https://api.github.com/repos/${config.repo}/contents/${path}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
    };

    try {
        // Nếu chưa có SHA trong cache (VD: vừa chuyển từ Offline sang Cloud), thử lấy SHA hiện tại nếu file đã tồn tại trên GitHub
        if (!shaCache.has(vaultName)) {
            const metaRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/${path}?_t=${Date.now()}`, {
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    Accept: 'application/vnd.github+json'
                }
            });
            if (metaRes.ok) {
                const meta = await metaRes.json();
                if (meta.sha) shaCache.set(vaultName, meta.sha);
            }
        }

        const res = await doPut(shaCache.get(vaultName));

        if (res.status === 409) {
            throw new Error('Xung đột phiên bản trên GitHub (két vừa được cập nhật từ thiết bị khác). Hãy bấm Đồng bộ hoặc Xuất Backup trước!');
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.content?.sha) {
            shaCache.set(vaultName, data.content.sha);
        }
        const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        notifySyncState('saved', `Đã lưu GitHub lúc ${timeStr}`);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Không thể lưu lên GitHub';
        notifySyncState('error', `Lỗi đồng bộ: ${msg}`);
        throw new Error(msg);
    }
}

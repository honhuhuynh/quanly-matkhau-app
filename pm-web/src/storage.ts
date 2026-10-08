export interface GithubConfig {
    repo: string; // e.g. "owner/repo"
    token: string;
}

export function getGithubConfig(): GithubConfig | null {
    const repo = localStorage.getItem('gh_repo');
    const token = localStorage.getItem('gh_token');
    if (repo && token) return { repo, token };
    return null;
}

export function saveGithubConfig(repo: string, token: string) {
    localStorage.setItem('gh_repo', repo);
    localStorage.setItem('gh_token', token);
}

const shaCache = new Map<string, string>();

function utf8ToBase64(str: string) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUtf8(b64: string) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

export async function listAvailableVaults(): Promise<string[]> {
    const config = getGithubConfig();
    const vaults: string[] = [];

    if (!config) return vaults; // Trống nếu chưa cấu hình

    try {
        const res = await fetch(`https://api.github.com/repos/${config.repo}/contents`, {
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
        if (res.ok) {
            const files = await res.json();
            for (const f of files) {
                if (f.name.startsWith('vault_') && f.name.endsWith('.enc')) {
                    const vaultName = f.name.replace('vault_', '').replace('.enc', '');
                    if (!vaults.includes(vaultName)) vaults.push(vaultName);
                }
            }
        }
    } catch (e) {
        console.error("Github API Error:", e);
    }
    return vaults;
}

export async function fetchVaultData(vaultName: string): Promise<string | null> {
    const config = getGithubConfig();
    if (!config) {
        throw new Error("⚠️ HỆ THỐNG YÊU CẦU ĐỒNG BỘ: Vui lòng bấm vào nút Cài đặt ⚙️ góc phải để kết nối Github trước khi mở két.");
    }
    
    try {
        const path = `vault_${vaultName}.enc`;
        const res = await fetch(`https://api.github.com/repos/${config.repo}/contents/${path}`, {
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Accept': 'application/vnd.github+json',
                // Thêm timestamp để bypass cache của Github
                'If-None-Match': ''
            }
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("Lỗi kết nối Github (Sai Token hoặc Repo)");
        
        const data = await res.json();
        shaCache.set(vaultName, data.sha);
        const b64 = data.content.replace(/\n/g, '');
        const content = base64ToUtf8(b64);
        return content;
    } catch (e: any) {
        throw new Error(e.message || "Lỗi lấy data từ Github");
    }
}

export async function saveVaultData(vaultName: string, content: string): Promise<void> {
    const config = getGithubConfig();
    if (!config) {
        throw new Error("Lỗi: Yêu cầu kết nối Github để lưu dữ liệu!");
    }

    const path = `vault_${vaultName}.enc`;
    const b64Content = utf8ToBase64(content);
    const sha = shaCache.get(vaultName);

    const body: any = {
        message: `[Auto] Update vault: ${vaultName}`,
        content: b64Content
    };
    if (sha) {
        body.sha = sha;
    }

    const res = await fetch(`https://api.github.com/repos/${config.repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${config.token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error("Lỗi khi lưu lên Github: " + err.message);
    }
    
    const data = await res.json();
    // Cập nhật SHA mới để lần sau ghi đè không bị lỗi conflict
    shaCache.set(vaultName, data.content.sha);
}

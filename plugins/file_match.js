import md5 from 'md5';
import Database from 'better-sqlite3';

export default async function filter(response) {
    // 检查响应的 URL 是否在数据库中匹配
    try {
        const { pathname } = new URL(response.url());
        
        // 如果是重定向响应，获取重定向目标的pathname
        let targetPathname = pathname;
        if (response.status() >= 300 && response.status() < 400) {
            const locationHeader = response.headers()['location'];
            if (locationHeader) {
                try {
                    const redirectUrl = new URL(locationHeader, response.url());
                    targetPathname = redirectUrl.pathname;
                    console.log(`[FileMatch] 检测到重定向: ${pathname} -> ${targetPathname}`);
                } catch (e) {
                    console.log(`[FileMatch] 无法解析重定向URL: ${locationHeader}`);
                }
            }
        }
    
        // 连接到数据库
        const db = new Database('./plugins/file_match.db');

        // 创建表（如果不存在）
        db.exec(`
            CREATE TABLE IF NOT EXISTS file_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pathname TEXT NOT NULL,
            md5_hash TEXT NOT NULL,
            tech_stack TEXT,
            description TEXT
            )
        `);
        
        // 查询数据库中是否有匹配的 pathname（检查原始路径和重定向路径）
        const stmt = db.prepare('SELECT * FROM file_matches WHERE pathname = ? OR pathname = ?');
        const matches = stmt.all(pathname, targetPathname);
        
        if (matches.length > 0) {
            console.log(`[FileMatch] 找到匹配的路径记录:`, matches.length, '条', `(原始: ${pathname}, 目标: ${targetPathname})`);
            
            // 对于重定向响应，不检查MD5（因为重定向响应体通常不是目标文件）
            if (response.status() >= 300 && response.status() < 400) {
                console.log(`[FileMatch] 重定向响应，跳过MD5检查`);
                // 返回匹配的技术栈，但标记为重定向发现
                db.close();
                return matches[0].tech_stack;
            }
            
            // 获取响应体
            const body = await response.buffer();
            const actualMd5 = md5(body);
            console.log(`[FileMatch] 实际 MD5:`, actualMd5);
            
            // 检查是否有匹配的 MD5
            for (const match of matches) {
                console.log(`[FileMatch] 期望 MD5:`, match.md5_hash);
                if (actualMd5 === match.md5_hash) {
                    console.log(`[FileMatch] [+] MD5 匹配成功 - 检测到:`, match.tech_stack);
                    db.close();
                    return match.tech_stack; // 返回技术栈信息
                }
            }
            
            console.log(`[FileMatch] [-] MD5 不匹配`);
            db.close();
            return null;
        } else {
            db.close();
            return null;
        }
        
    } catch (error) {
        console.error(`[FileMatch] 处理响应时发生错误:`, error.message);
        return null;
    }
}
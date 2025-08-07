import md5 from 'md5';
import Database from 'better-sqlite3';

export default async function filter(response) {
    // 检查响应的 URL 是否在数据库中匹配
    try {
        const { pathname } = new URL(response.url());
    
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
        
        // 查询数据库中是否有匹配的 pathname
        const stmt = db.prepare('SELECT * FROM file_matches WHERE pathname = ?');
        const matches = stmt.all(pathname);
        
        if (matches.length > 0) {
            console.log('找到匹配的路径记录:', matches.length, '条');
            
            // 获取响应体
            const body = await response.buffer();
            const actualMd5 = md5(body);
            console.log('实际 MD5:', actualMd5);
            
            // 检查是否有匹配的 MD5
            for (const match of matches) {
                console.log('期望 MD5:', match.md5_hash);
                if (actualMd5 === match.md5_hash) {
                    console.log('[+] MD5 匹配成功 - 检测到:', match.tech_stack);
                    db.close();
                    return match.tech_stack; // 返回技术栈信息
                }
            }
            
            console.log('[-] MD5 不匹配');
            db.close();
            return false;
        } else {
            db.close();
            return false;
        }
        
    } catch (error) {
        console.error('处理响应时发生错误:', error.message);
        return false;
    }
}
export default async function filter(response) {

    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('text/html')) {
        return null;
    }

    try {
        const headers = response.headers();
        const stack = [];

        // 定义技术栈关键词
        const techKeywords = [
            'nginx', 'apache', 'iis', 'tomcat', 'flask', 'express', 'kestrel', 'gunicorn', 'uvicorn',
            'php', 'asp.net', 'aspnet', 'django', 'rails', 'laravel', 'spring', 'node.js', 'nodejs',
            'cloudflare', 'fastly', 'akamai', 'amazon cloudfront', 'maxcdn', 'keycdn',
            'vue', 'react', 'angular', 'ember', 'backbone',
            'wordpress', 'drupal', 'joomla', 'magento', 'shopify'
        ];

        // 遍历所有请求头进行关键词匹配
        Object.entries(headers).forEach(([key, value]) => {
            if (typeof value !== 'string') return;
            
            const headerValue = value.toLowerCase();
            const headerKey = key.toLowerCase();
            
            techKeywords.forEach(keyword => {
                if (headerValue.includes(keyword) || headerKey.includes(keyword)) {
                    // 避免重复添加
                    if (!stack.includes(keyword)) {
                        stack.push(keyword);
                    }
                }
            });
        });

        if (stack.length > 0) {
            // console.log(`[HeaderMatch] 检测到技术栈:`, stack);
            return stack;
        }

        return null;
    } catch (error) {
        console.error(`[HeaderMatch] 分析技术栈时出错:`, error.message);
        return null;
    }
}

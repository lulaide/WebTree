export default async function filter(response) {

    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('text/html')) {
        return null;
    }

    try {
        const headers = response.headers();
        const stack = [];

        // 定义技术栈关键词 - 专注于可能存在漏洞的服务端技术
        const techKeywords = [
            // Web服务器
            'nginx', 'apache', 'iis', 'tomcat', 'jetty', 'undertow', 'lighttpd', 'caddy',
            
            // 编程语言和框架
            'php', 'asp.net', 'aspnet', 'django', 'flask', 'fastapi', 'rails', 'laravel', 'symfony', 
            'spring', 'struts', 'express', 'koa', 'nest', 'node.js', 'nodejs',
            
            // Java相关
            'weblogic', 'websphere', 'jboss', 'wildfly', 'glassfish', 'resin',
            
            // Python WSGI/ASGI服务器
            'gunicorn', 'uwsgi', 'uvicorn', 'hypercorn', 'waitress',
            
            // CMS和应用
            'wordpress', 'drupal', 'joomla', 'magento', 'prestashop', 'opencart', 
            'typo3', 'concrete5', 'modx', 'umbraco', 'sitecore', 'episerver',
            
            // 开发框架和平台
            'thinkphp', 'codeigniter', 'cakephp', 'yii', 'zend', 'phalcon',
            'ruby', 'sinatra', 'padrino', 'hanami',
            'go', 'gin', 'echo', 'beego', 'iris',
            'dotnet', 'mvc', 'webapi', 'blazor',
            
            // 数据库和中间件
            'mysql', 'postgresql', 'mssql', 'oracle', 'mongodb', 'redis',
            'elasticsearch', 'solr', 'kibana', 'grafana',
            
            // 其他常见服务
            'jenkins', 'gitlab', 'nexus', 'artifactory', 'sonarqube',
            'phpmyadmin', 'adminer', 'phpinfo'
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

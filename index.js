import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
puppeteer.use(StealthPlugin());
const program = new Command();
const execAsync = promisify(exec);

const Reset  = "\x1b[0m";
const Red    = "\x1b[31m";
const Green  = "\x1b[32m";
const Yellow = "\x1b[33m";
const Blue   = "\x1b[34m";

// 插件加载函数
async function loadPlugins() {
    const pluginsDir = './plugins';
    const plugins = {};

    // 动态导入plugins文件夹中的所有js文件
    const pluginFiles = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
    console.log(`${Green}[+] 找到 ${pluginFiles.length} 个插件${Reset}`);

    for (const file of pluginFiles) {
        const moduleName = path.basename(file, '.js');
        plugins[moduleName] = await import(`${pluginsDir}/${file}`);
        console.log(`${Green}[+] 插件 ${moduleName} 加载成功${Reset}`);
    }

    return plugins;
}

async function executePlugins(response, plugins) {
    const results = [];
    for (const [pluginName, plugin] of Object.entries(plugins)) {
        try {
            if (plugin.default && typeof plugin.default === 'function') {
                const result = await plugin.default(response);
                if (result) {
                    results.push(result);
                }
            }
        } catch (error) {
            console.error(`Error executing plugin ${pluginName}:`, error);
        }
    }
    return results;
}

async function extractor(url, browser, plugins) {
    const pluginResults = [];
    const page = await browser.newPage();
    
    // 监听所有网络响应
    page.on('response', async (response) => {
        const results = await executePlugins(response, plugins);
        if (results && results.length > 0) {
            pluginResults.push(...results.filter(result => result !== null));
        }
    });
    
    await page.goto(url, { waitUntil: 'networkidle2' });

    // 提取所有链接和表单信息
    const [allLinks, queryAndForms] = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const forms = Array.from(document.querySelectorAll('form'));
        // 提取所有链接（不过滤任何链接）
        const allLinks = links
            .map(link => link.href)
            .filter(href => href); // 只保留完整的 URL

        // 提取有查询参数的链接和表单
        const queryAndForms = links
            .map(link => link.href)
            .filter(href => href.includes('?')) // 只筛选包含查询参数的 URL
            .map(href => ({
                url: href,
                type: 'get'
            }));

        const formDetails = forms.map(form => {
            const method = form.method.toLowerCase() || 'get'; // Default to 'get' if method is not specified
            const action = form.action;
            const inputs = Array.from(form.querySelectorAll('input, select, textarea'))
                .map(input => {
                    const name = encodeURIComponent(input.name);
                    const value = encodeURIComponent(input.value || '');
                    return `${name}=${value}`;
                });

            const queryString = inputs.join('&');
            const baseUrl = action ? new URL(action, window.location.href).href : window.location.href;

            if (method === 'get') {
                const urlObject = new URL(baseUrl);
                if (queryString) {
                    urlObject.search = urlObject.search ? `${urlObject.search}&${queryString}` : queryString;
                }
                return {
                    url: urlObject.href,
                    type: 'get'
                };
            } else {
                // For POST requests, keep data separate
                return {
                    url: baseUrl,
                    type: method,
                    data: queryString
                };
            }
        });

        // 合并查询 URL 和表单数据
        return [allLinks, [...queryAndForms, ...formDetails]];
    });

    await page.close();
    
    // 返回三个数组：所有链接、包含查询参数及表单的数组、插件结果
    return [allLinks, queryAndForms, pluginResults];
}

export async function genWebTree(visited) {
  if (!visited?.length) return '';

  /** ---------- 1. 把路径写进一棵普通 JS 对象树 ---------- */
  const tree = Object.create(null);                // { segment: { childSegment: {...} } }
  const baseOrigin = new URL(visited[0]).origin;   // 假设都在同一站点

  for (const link of visited) {
    const u = new URL(link);
    // 拆分路径段；过滤掉第 0 个空串（因为 "/a/b" 首位是空）
    const segments = u.pathname.split('/').filter(Boolean);

    // 末段若带查询串，加到段尾；形如 "users?page=1&limit=10"
    if (u.search) {
      if (segments.length) {
        segments[segments.length - 1] += u.search;
      } else {
        // 根目录直接带查询串（少见，但处理一下）
        segments.push(u.search.slice(1));
      }
    }

    // 逐层落到 tree 里
    let cursor = tree;
    for (const seg of segments) {
      cursor[seg] ??= Object.create(null);
      cursor = cursor[seg];
    }
  }

  /** ---------- 2. 把对象树渲染成带 ├─ / └─ 的 ASCII 树 ---------- */
  const lines = [];
  const draw = (node, prefix = '') => {
    const keys = Object.keys(node);
    keys.forEach((k, idx) => {
      const isLast = idx === keys.length - 1;
      lines.push(`${prefix}${isLast ? '└─' : '├─'}${k}`);
      draw(node[k], prefix + (isLast ? '  ' : '│  '));
    });
  };
  draw(tree);

  /** ---------- 3. 顶部加根域名，返回 ---------- */
  return `${baseOrigin}/\n${lines.join('\n')}`;
}

// POC 测试函数
async function executePocTests(techStack, targetUrl, detailMode = false) {
    if (!techStack || techStack.length === 0) {
        console.log(`${Yellow}[!] 没有检测到技术栈，跳过POC测试${Reset}`);
        return { pocResults: [], totalUniquePocs: 0, detailResults: [] };
    }

    console.log(`${Blue}[*] 开始执行POC测试...${Reset}`);
    const pocResults = [];
    const uniquePocs = new Set(); // 用于去重POC
    const detailResults = []; // 存储详细结果
    
    for (const tech of techStack) {
        try {
            console.log(`${Blue}[*] 正在测试技术栈: ${tech}${Reset}`);
            
            // 构建POC命令
            const command = `./go-poc search --keyword ${tech} --target ${targetUrl} --all`;
            
            const result = await execAsync(command, { 
                cwd: './go-poc',
                timeout: 60000 // 60秒超时
            });
            
            // 如果是详细模式，保存完整输出
            if (detailMode && result.stdout) {
                detailResults.push({
                    keyword: tech,
                    command: command,
                    stdout: result.stdout,
                    stderr: result.stderr || ''
                });
                
                // 详细模式下输出完整结果
                console.log(`${Green}[+] ${tech} POC测试详细结果:${Reset}`);
                console.log(result.stdout);
                if (result.stderr) {
                    console.log(`${Yellow}[!] ${tech} POC测试警告:${Reset}`);
                    console.log(result.stderr);
                }
            }
            
            if (result.stdout) {
                // 解析输出，只提取成功的POC结果
                const lines = result.stdout.split('\n');
                const successfulPocs = [];
                
                lines.forEach(line => {
                    // 匹配包含"执行成功"的行
                    if (line.includes('执行成功') && line.includes('目标可能存在漏洞')) {
                        // 提取POC名称
                        const pocMatch = line.match(/POC\s+([^\s]+)/);
                        if (pocMatch) {
                            const pocName = pocMatch[1];
                            
                            // 检查是否已经发现过这个POC
                            if (!uniquePocs.has(pocName)) {
                                uniquePocs.add(pocName);
                                const successMsg = `【成功】POC ${pocName} 执行成功，目标可能存在漏洞！`;
                                // 非详细模式下才输出简洁的成功消息
                                if (!detailMode) {
                                    console.log(`${Green}${successMsg}${Reset}`);
                                }
                                successfulPocs.push(successMsg);
                            }
                        }
                    }
                });
                
                if (successfulPocs.length > 0) {
                    pocResults.push({
                        keyword: tech,
                        successfulPocs: successfulPocs,
                        status: 'success'
                    });
                }
            }
            
        } catch (error) {
            // 详细模式下输出错误信息
            if (detailMode) {
                console.error(`${Red}[!] ${tech} POC测试失败: ${error.message}${Reset}`);
                detailResults.push({
                    keyword: tech,
                    command: `./go-poc search --keyword ${tech} --target ${targetUrl} --all`,
                    error: error.message,
                    status: 'error'
                });
            } else {
                console.log(`${Yellow}[!] ${tech} POC测试完成${Reset}`);
            }
        }
    }
    
    // 返回去重后的POC总数和详细结果
    return { pocResults, totalUniquePocs: uniquePocs.size, detailResults };
}

async function main(startUrl, options) {
    // 验证--detail选项的使用
    if (options.detail && !options.poc) {
        console.error(`${Red}[!] --detail 选项需要与 --poc 一起使用${Reset}`);
        process.exit(1);
    }
    
    // 在主程序开始时加载插件
    const plugins = await loadPlugins();
    
    const CONCURRENCY = parseInt(options.concurrency, 10);
    const MAX_LINKS = parseInt(options.maxLinks, 10);
    console.log(`${Blue}[*] 最大访问链接数限制: ${MAX_LINKS}${Reset}`);
    
    const browser = await puppeteer.launch({
        headless: options.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        timeout: 300000
    });
    
    const domain = new URL(startUrl).hostname;

    const toVisit = new Set([startUrl]); // 使用 Set 自动处理重复链接
    const visited = new Set();
    const allQueriesAndForms = [];
    const existingQueries = new Set();
    const allPluginResults = [];
    const existingPluginResults = new Set();
    const fileExtensions = new Set(['.zip', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.exe', '.msi', '.rar', '.tar', '.gz', '.svg', '.webp', '.avi', '.mov', '.wmv', '.csv', '.txt', '7z', '.tar.gz', '.tar.bz2', '.tar.xz', '.iso', '.apk', '.dmg', '.pkg', '.deb', '.rpm', '.msi', '.bin', '.sh']);

    async function processUrl(url) {
        if (visited.has(url) || visited.size >= MAX_LINKS) {
            return;
        }

        visited.add(url);
        toVisit.delete(url);

        try {
            console.log(`正在访问: ${url} (${visited.size}/${MAX_LINKS})`);
            const [newLinks, newQueriesAndForms, pluginResults] = await extractor(url, browser, plugins);

            // 收集所有插件结果，并去重
            if (pluginResults && pluginResults.length > 0) {
                pluginResults.flat().forEach(result => {
                    if (!existingPluginResults.has(result)) {
                        allPluginResults.push(result);
                        existingPluginResults.add(result);
                    }
                });
            }

            // 将新链接添加到队列
            if (newLinks) {
              for (const link of newLinks) {
                try {
                  const linkUrl = new URL(link);
                  if (linkUrl.hostname === domain) {
                    // 创建不带查询参数的URL用于去重检查
                    const urlWithoutQuery = linkUrl.origin + linkUrl.pathname;
                    
                    if (!visited.has(urlWithoutQuery)) {
                      const pathname = linkUrl.pathname.toLowerCase();
                      const isFile = Array.from(fileExtensions).some(ext => pathname.endsWith(ext));

                      if (isFile) {
                        console.log(`发现文件链接，跳过访问: ${link}`);
                        visited.add(urlWithoutQuery); // 添加到已访问集合，以避免重复处理
                      } else {
                        toVisit.add(urlWithoutQuery); // 添加不带查询参数的URL
                      }
                    }
                  }
                } catch (e) {
                  // 忽略无效的 URL
                }
              }
            }

            // 添加新的表单和查询参数，确保没有重复
            if (newQueriesAndForms && newQueriesAndForms.length > 0) {
              for (const item of newQueriesAndForms) {
                const itemString = JSON.stringify(item);
                if (!existingQueries.has(itemString)) {
                  allQueriesAndForms.push(item);
                  existingQueries.add(itemString);
                    }
                }
            }
        } catch (error) {
            console.error(`访问失败 ${url}: ${error.message}`);
        }
    }

    while (toVisit.size > 0 && visited.size < MAX_LINKS) {
        const currentBatch = Array.from(toVisit).slice(0, CONCURRENCY);
        
        // 检查当前批次是否会超过限制
        const remainingSlots = MAX_LINKS - visited.size;
        const batchToProcess = currentBatch.slice(0, remainingSlots);
        
        if (batchToProcess.length > 0) {
            await Promise.all(batchToProcess.map(url => processUrl(url)));
        }
        
        // 如果已达到限制，退出循环
        if (visited.size >= MAX_LINKS) {
            console.log(`${Yellow}[!] 已达到最大访问链接数限制 (${MAX_LINKS})，停止爬取${Reset}`);
            break;
        }
    }

    const visitedLinks = Array.from(visited);
    const siteTree = await genWebTree(visitedLinks);

    // 执行POC测试（如果启用）
    let pocResults = [];
    let totalUniquePocs = 0;
    let detailResults = [];
    if (options.poc) {
        const pocTestResult = await executePocTests(allPluginResults, startUrl, options.detail);
        pocResults = pocTestResult.pocResults;
        totalUniquePocs = pocTestResult.totalUniquePocs;
        detailResults = pocTestResult.detailResults;
    }

    const outputData = {
        '扫描统计': {
            '已访问链接数': visited.size,
            '待访问链接数': toVisit.size,
            '最大链接数限制': MAX_LINKS,
            '是否达到限制': visited.size >= MAX_LINKS
        },
        '检测到的技术栈': allPluginResults,
        '所有已访问的链接': visitedLinks,
        '生成的站点树': siteTree,
        '所有查询和表单信息': allQueriesAndForms,
        'POC测试结果': pocResults,
        'POC详细执行结果': detailResults
    };

    if (options.output) {
        try {
            await fs.writeFile(options.output, JSON.stringify(outputData, null, 2));
            console.log(`\n结果已保存到 ${options.output}`);
        } catch (error) {
            console.error(`\n保存文件失败: ${error.message}`);
        }
    } else {
        console.log('\n爬取完成.');
        console.log(`${Blue}扫描统计: 访问了 ${visited.size} 个链接，队列中还有 ${toVisit.size} 个待访问${Reset}`);
        
        // 默认输出技术栈
        console.log('检测到的技术栈:', allPluginResults);
        
        // 根据选项输出站点树
        if (options.tree) {
            console.log('生成的站点树:\n', siteTree);
        }
        
        // 根据选项输出查询和表单信息
        if (options.query) {
            console.log('所有查询和表单信息:', allQueriesAndForms);
        }
        
        // 根据选项输出已访问的链接
        if (options.links) {
            console.log('所有已访问的链接:', visitedLinks);
        }
        
        // 如果执行了POC测试，显示结果汇总
        if (options.poc) {
            console.log('\n=== POC测试结果汇总 ===');
            console.log(`${Green}共发现 ${totalUniquePocs} 个潜在漏洞${Reset}`);
        }
    }

    await browser.close();
}

program
    .version('1.1.0')
    .description('一个强大的网站爬虫和信息提取工具')
    .argument('<url>', '要爬取的起始 URL')
    .option('-c, --concurrency <number>', '并发请求数', '10')
    .option('-m, --max-links <number>', '最大访问链接数量限制', '100')
    .option('-o, --output <file>', '将结果输出到指定文件')
    .option('-t, --tree', '输出站点树结构')
    .option('-q, --query', '输出查询和表单信息')
    .option('-l, --links', '输出所有已访问的链接')
    .option('--poc', '使用检测到的技术栈执行POC测试')
    .option('--detail', '输出所有POC的详细执行结果（需与--poc一起使用）')
    .option('--no-headless', '以非无头模式运行浏览器')
    .action(main);

program.parse(process.argv);
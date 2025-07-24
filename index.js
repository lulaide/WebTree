import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Command } from 'commander';
import fs from 'fs/promises';
puppeteer.use(StealthPlugin());


async function extractor(url, browser) {
    const page = await browser.newPage();
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

    // 返回两个数组：所有链接和包含查询参数及表单的数组
    return [allLinks, queryAndForms];
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

puppeteer.use(StealthPlugin());

const program = new Command();

async function main(startUrl, options) {
    const CONCURRENCY = parseInt(options.concurrency, 10);
    const browser = await puppeteer.launch({
        headless: options.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const domain = new URL(startUrl).hostname;

    const toVisit = new Set([startUrl]); // 使用 Set 自动处理重复链接
    const visited = new Set();
    const allQueriesAndForms = [];
    const existingQueries = new Set();
    const fileExtensions = new Set(['.zip', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.exe', '.msi', '.rar', '.tar', '.gz', '.svg', '.webp', '.avi', '.mov', '.wmv', '.csv', '.txt', '7z', '.tar.gz', '.tar.bz2', '.tar.xz', '.iso', '.apk', '.dmg', '.pkg', '.deb', '.rpm', '.msi', '.bin', '.sh']);

    async function processUrl(url) {
        if (visited.has(url)) {
            return;
        }

        visited.add(url);
        toVisit.delete(url);

        try {
            console.log(`正在访问: ${url}`);
            const [newLinks, newQueriesAndForms] = await extractor(url, browser);

            // 将新链接添加到队列
            if (newLinks) {
              for (const link of newLinks) {
                try {
                  const linkUrl = new URL(link);
                  if (linkUrl.hostname === domain && !visited.has(link)) {
                    const pathname = linkUrl.pathname.toLowerCase();
                    const isFile = Array.from(fileExtensions).some(ext => pathname.endsWith(ext));

                    if (isFile) {
                      console.log(`发现文件链接，跳过访问: ${link}`);
                      visited.add(link); // 添加到已访问集合，以避免重复处理
                    } else {
                      toVisit.add(link);
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

    while (toVisit.size > 0) {
        const currentBatch = Array.from(toVisit).slice(0, CONCURRENCY);
        await Promise.all(currentBatch.map(url => processUrl(url)));
    }

    const visitedLinks = Array.from(visited);
    const siteTree = await genWebTree(visitedLinks);

    const outputData = {
        '所有已访问的链接': visitedLinks,
        '生成的站点树': siteTree,
        '所有查询和表单信息': allQueriesAndForms
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
        console.log('所有已访问的链接:', visitedLinks);
        console.log('生成的站点树:\n', siteTree);
        console.log('所有查询和表单信息:', allQueriesAndForms);
    }

    await browser.close();
}

program
    .version('1.1.0')
    .description('一个强大的网站爬虫和信息提取工具')
    .argument('<url>', '要爬取的起始 URL')
    .option('-c, --concurrency <number>', '并发请求数', '10')
    .option('-o, --output <file>', '将结果输出到指定文件')
    .option('--no-headless', '以非无头模式运行浏览器')
    .action(main);

program.parse(process.argv);
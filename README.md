# WebTree

一个模仿真实访问行为的浏览器爬虫，支持流量过滤插件，POC 测试。

## 添加子仓库

``` bash
git submodule add https://github.com/lulaide/go-poc.git go-poc
git submodule update --init --recursive
```

## 安装依赖

### 无头浏览器依赖

``` bash
npm install
```

### Go 依赖

``` bash
cd go-poc
go mod tidy
go build
cd ..
```

## 使用方法

- 生成站点树
  
``` bash
node index.js http://localhost:3000/ -t
```

``` txt
生成的站点树:
 http://localhost:3000/
├─dashboards
├─playlists
├─alerting
│  └─list
├─login
└─user
  └─password
    └─send-reset-email
```

- 扫描注入点

``` bash
node index.js http://localhost:3000/ -q
```

``` txt
所有查询和表单信息: 
[
  { url: 'http://localhost:3000/login?forceLogin=true', type: 'get' },
  {
    url: 'https://grafana.com/docs/grafana/latest/?utm_source=grafana_footer',
    type: 'get'
  },
  {
    url: 'https://grafana.com/products/enterprise/?utm_source=grafana_footer',
    type: 'get'
  },
  {
    url: 'https://community.grafana.com/?utm_source=grafana_footer',
    type: 'get'
  }，
...
]
```

- POC 测试

``` bash
node index.js http://localhost:3000/ --poc
```

可以使用 --detail 参数来查看详细的 POC 测试结果。

## POC功能上手测试

可以使用以下靶机来测试一些已知的漏洞：

``` txt
vulhub/httpd/CVE-2021-41773
vulhub/grafana/CVE-2021-43798
```

``` bash
❯ node index.js http://localhost:8080  --poc
[+] 找到 2 个插件
[+] 插件 file_match 加载成功
[+] 插件 header_match 加载成功
正在访问: http://localhost:8080
[*] 开始执行POC测试...
[*] 正在测试技术栈: apache
【成功】POC poc-yaml-apache-httpd-cve-2021-41773-path-traversal 执行成功，目标可能存在漏洞！

爬取完成.
检测到的技术栈: [ 'apache' ]

=== POC测试结果汇总 ===
共发现 1 个潜在漏洞
```

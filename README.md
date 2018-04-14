## huaban-crawl
Crawl images on [花瓣](https://huaba.com) by two ways: all boards of user or single board.

The command program powerd by Node and was written with TypeScript.

## Pre Requirements
- [Node](https://nodejs.org/zh-cn/download/)
- [Yarn](https://yarnpkg.com/zh-Hans/docs/install)

## Installtion
```shell
git clone https://github.com/Jancat/huaban-crawl.git
cd huaban-crawl
yarn
```

## Usage
Input needed message and wait...
(An average of 5 images download a second. And image lost may occur in some board.)

```shell
yarn start

请选择下载方式（1. 下载用户所有画板; 2. 下载单个画板）：2
画板ID：17713754
下载路径（默认 ./images/）：

开始下载画板 17713754 - ◈ 青春校服 ◈，图片数量：319
Done. 成功 319 个

✅ All Done!
共下载 319 张图
```

## Backlog
- Add test
- bug fix: missed pins data
- import [node-request-retry](https://github.com/FGRibreau/node-request-retry) to retry failed images download

**Enjoy the picture world!**
/**
 * @author Jancat
 * @email 510675621@qq.com
 * @create date 2018-04-14 12:19:03
 * @modify date 2018-04-14 12:19:03
 * @desc Node command program to crawl HuaBan(https://huaban.com/) images
 */

import async from 'async'
import fs from 'fs-extra'
import readline from 'readline'
import rp from 'request-promise'

/* terminal font color reference:
Reset = "\x1b[0m"
Bright = "\x1b[1m"
Dim = "\x1b[2m"
Underscore = "\x1b[4m"
Blink = "\x1b[5m"
Reverse = "\x1b[7m"
Hidden = "\x1b[8m"

FgBlack = "\x1b[30m"
FgRed = "\x1b[31m"
FgGreen = "\x1b[32m"
FgYellow = "\x1b[33m"
FgBlue = "\x1b[34m"
FgMagenta = "\x1b[35m"
FgCyan = "\x1b[36m"
FgWhite = "\x1b[37m"

e.g.
console.log('\x1b[33m%s\x1b[0m', stringToMakeYellow);  */

let downloadPath: string
let totalDownload: number = 0
const imageServer: string = 'http://img.hb.aicdn.com'
const huabanDomain: string = 'https://huaban.com'

// 图片类型
const imagesTypes: { [key: string]: string } = {
  'image/bmp': '.bmp',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/x-icon': '.ico',
  'image/tiff': '.tif',
  'image/vnd.wap.wbmp': '.wbmp',
}

// 关键头部，添加该项后服务器只会返回json数据，而不是包含json的HTML
const jsonRequestHeader = {
  Accept: 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
}

interface IPin {
  pin_id: string
  file: {
    key: string
    type: string
  }
}

interface IBoard {
  board_id: string
  title: string
  pins: IPin[]
  pin_count: number
}

interface IUser {
  board_count: number
  boards: IBoard[]
}

interface IError {
  message?: string
}

const rl: readline.ReadLine = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

// 提供两种下载方式：
//    1. 提供用户名下载用户所有画板
//    2. 提供画板ID下载画板
rl.question('请选择下载方式（1. 下载用户所有画板; 2. 下载单个画板）：', option => {
  switch (option) {
    case '1':
      downloadBoardsOfUserOption()
      break
    case '2':
      downloadSingleBoardOption()
      break
    default:
      console.error('\x1b[31m没有该选项！\x1b[0m')
      process.exit(1)
  }
})

// 获取用户画板
async function getUserBoards(username: string): Promise<IBoard[]> {
  const allUserBoards: IBoard[] = []

  async function getBoards(lastBoardId?: string): Promise<void> {
    const response: {
      err?: number
      user?: IUser
    } = await rp({
      uri: `${huabanDomain}/${username}/`,
      qs: {
        limit: 100,
        max: lastBoardId,
      },
      headers: jsonRequestHeader,
      json: true,
    })

    if (response.err === 404) {
      throw new Error('用户不存在！')
    } else if (!response.user!.board_count) {
      throw new Error('用户没有画板！')
    }

    const user: IUser = response.user!
    const requestUserBoardsCount = user.boards.length
    allUserBoards.push(...user.boards)

    // 获取所有画板数据
    if (requestUserBoardsCount && allUserBoards.length < user.board_count) {
      await getBoards(user.boards[requestUserBoardsCount - 1].board_id)
    }
  }

  await getBoards()
  return allUserBoards
}

async function getBoardInfo(boardId: string): Promise<IBoard> {
  const response: {
    err?: number
    board: IBoard
  } = await rp({
    uri: `${huabanDomain}/boards/${boardId}/`,
    headers: jsonRequestHeader,
    qs: {
      limit: 1,
    },
    json: true,
  })
  if (response.err === 404) {
    throw new Error('画板不存在！')
  }

  return response.board
}

// 获取画板中全部pins(图片)数据
async function getPins(boardId: string): Promise<IPin[]> {
  const allPins: IPin[] = []

  async function loadPins(lastPinId: string = ''): Promise<void> {
    // limit 查询参数限制获取的pin数量，最大100，默认20
    const response = await rp({
      uri: `${huabanDomain}/boards/${boardId}/`,
      qs: {
        limit: 100,
        max: lastPinId,
      },
      headers: jsonRequestHeader,
      json: true,
    })

    const board = response.board
    // if (response.headers['content-type']!.includes('text/html')) {
    //   // 匹配 boards json 串
    //   const boardJson: string = /app\.page\["board"\]\s=\s({.*});/.exec(response)![1]
    //   board = JSON.parse(boardJson)
    // }
    allPins.push(...board.pins)

    // 当此次获取的pins为空或者全部pins已获取完，则返回
    const pinsChunkLength: number = board.pins.length
    if (pinsChunkLength && allPins.length < board.pin_count) {
      // 用最后一个pin id作为下一次请求的max值，表示获取该pin后面的pins
      await loadPins(board.pins[pinsChunkLength - 1].pin_id)
    }
  }

  await loadPins()
  return allPins
}

// 根据pins下载图片
async function downloadImage(allPins: IPin[], boardPath: string): Promise<number> {
  let downloadCount: number = 0
  const errorImageUrl: Array<{ url: string; path: string }> = []

  // 重试下载失败的图片
  function retry() {
    for (const image of errorImageUrl) {
      rp({
        uri: image.url,
        timeout: 20 * 1000,
        encoding: null, // make response a Buffer to write image correctly
      }).pipe(
        fs.createWriteStream(image.path).on('finish', () => {
          totalDownload++
          console.log('\x1b[32m Retry ok! \x1b[0m %s', image.url)
        }),
      )
    }
  }

  function download(pin: IPin, cb: () => void): void {
    const imageUrl: string = `${imageServer}/${pin.file.key}_fw658`
    const imageName: string = `${pin.pin_id}${imagesTypes[pin.file.type] || '.jpg'}`

    rp({
      uri: imageUrl,
      timeout: 20 * 1000,
      encoding: null, // make response a Buffer to write image correctly
    })
      .then(data => {
        downloadCount++

        fs.writeFile(`${boardPath}/${imageName}`, data, error => {
          error && console.error('\x1b[31m%s\x1b[0m%s', error.message, imageUrl)
        })
      })
      .catch(error => {
        console.error('\x1b[31m%s %s.\x1b[0m %s', 'Download image failed.', error.message, imageUrl)
        errorImageUrl.push({ url: imageUrl, path: `${boardPath}/${imageName}` })
      })
      .finally(cb)
  }

  // async控制并发下载数，否则并发数太高Node会失去响应
  return new Promise<number>(resolve => {
    // 同一时间最多有10个(不能太高)并发请求
    async.eachLimit(allPins, 10, download, (error: IError | undefined) => {
      if (error) {
        throw error
      }
      errorImageUrl.length && retry()
      resolve(downloadCount)
    })
  })
}

async function getPinsAndDownload(board: IBoard): Promise<void> {
  const boardPins = await getPins(board.board_id)
  // TODO: 有些画板获取的pins数据不全？
  const missedPinsCount = board.pin_count - boardPins.length

  const boardPath = `${downloadPath}/${board.board_id} - ${board.title}`
  fs.emptyDirSync(boardPath)

  const downloadCount: number = await downloadImage(boardPins, boardPath)
  const failedCount: number = board.pin_count - downloadCount - missedPinsCount
  totalDownload += downloadCount

  console.log(
    `Done. 成功 %d 个${failedCount ? `，失败 \x1b[31m${failedCount}\x1b[0m个` : ''}${
      missedPinsCount ? `，丢失 \x1b[31m${missedPinsCount}\x1b[0m 个` : ''
    }`,
    downloadCount,
  )
}

function outputResult() {
  console.log('\n\x1b[32m✅ All Done!\x1b[0m')
  console.log('共下载 \x1b[32m%d\x1b[0m 张图片', totalDownload)
  console.log('\x1b[33m')
  console.timeEnd('Total time')
  console.log('\x1b[0m')
  process.exit(0)
}

async function downloadBoardsOfUser(username: string): Promise<void> {
  console.time('Total time')
  const userBoards: IBoard[] = await getUserBoards(username)

  console.log('\n用户 [%s] 画板数量：%d', username, userBoards.length)

  // 顺序下载画板，并行下载会失控
  for (const board of userBoards) {
    console.log(
      '\n开始下载画板：[%s - %s]，图片数量：%d',
      board.board_id,
      board.title,
      board.pin_count,
    )
    await getPinsAndDownload(board)
  }

  outputResult()
}

async function downloadSingleBoard(boardId: string): Promise<void> {
  console.time('Total time')
  const board = await getBoardInfo(boardId)
  console.log('\n开始下载画板 %s - %s，图片数量：%d', boardId, board.title, board.pin_count)

  await getPinsAndDownload(board)
  outputResult()
}

function downloadBoardsOfUserOption(): void {
  rl.question('请输入地址栏中的用户名：', username => {
    if (!username) {
      console.log('\x1b[31m用户名为空，请重新输入！\x1b[0m')
      downloadBoardsOfUserOption()
    } else {
      rl.question('下载路径（默认 ./images/）：', async path => {
        downloadPath = path || 'images'
        try {
          await downloadBoardsOfUser(username)
        } catch (error) {
          console.error('\x1b[31m%s\x1b[0m', error.message)
          process.exit(1)
        }
      })
    }
  })
}

function downloadSingleBoardOption(): void {
  // 输入画板ID和下载路径
  rl.question('画板ID：', boardId => {
    if (!boardId) {
      console.log('\x1b[31m画板ID为空，请重新输入！\x1b[0m')
      downloadSingleBoardOption()
    } else {
      rl.question('下载路径（默认 ./images/）：', async path => {
        downloadPath = path || 'images'

        try {
          await downloadSingleBoard(boardId)
        } catch (error) {
          console.error('\x1b[31m%s\x1b[0m', error.message)
          process.exit(1)
        }
      })
    }
  })
}

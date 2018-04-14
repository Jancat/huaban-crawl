import async from 'async'
import fs from 'fs-extra'
import readline from 'readline'
import rp from 'request-promise'

let downloadPath: string
let allDownloadCount: number = 0
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

rl.question('请选择下载方式（1. 下载用户所有画板; 2. 下载单个画板）：', option => {
  try {
    switch (option) {
      case '1':
        downloadBoardsOfUserOption()
        break
      case '2':
        downloadSingleBoardOption()
        break
      default:
        console.log('没有该选项！')
        process.exit(1)
    }
  } catch (error) {
    console.log('Error:', error.message)
    process.exit(1)
  }
})

// 获取用户画板
async function getUserBoards(username: string): Promise<IBoard[]> {
  const response = await rp({
    uri: `${huabanDomain}/${username}/`,
    headers: jsonRequestHeader,
    json: true,
  })

  const user: IUser = response.user

  if (!user.board_count) {
    throw new Error('该用户没有画板！')
  }

  return user.boards
}

// 获取画板中全部pins(图片)数据
async function getPins(boardId: string, boardName?: string): Promise<IPin[]> {
  const loadedPinsCount: number = 0
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

async function getBoard(boardId: string): Promise<IBoard> {
  const response = await rp({
    uri: `${huabanDomain}/boards/${boardId}/`,
    headers: jsonRequestHeader,
    qs: {
      limit: 1,
    },
    json: true,
  })

  return response.board
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
      }).pipe(
        fs.createWriteStream(image.path).on('finish', () => {
          downloadCount++
          console.log('\x1b[32m Retry ok! \x1b[0m %s', image.url)
        }),
      )
    }
  }

  // async控制并发下载数，否则并发数太高Node会失去响应
  return new Promise<number>((resolve, reject) => {
    async.eachLimit(
      allPins,
      10,
      (pin: IPin, cb: () => void) => {
        const imageUrl: string = `${imageServer}/${pin.file.key}_fw658`
        const imageName: string = `${pin.pin_id}${imagesTypes[pin.file.type] || '.jpg'}`
        // const ws: fs.WriteStream = fs.createWriteStream(`${boardPath}/${imageName}`)

        // ws.on('finish', () => {
        //   downloadCount++
        //   cb()
        // })
        rp({
          uri: imageUrl,
          timeout: 20 * 1000,
        })
          .then(data => {
            downloadCount++

            fs.writeFile(`${boardPath}/${imageName}`, data, error => {
              error && console.error('\x1b[31m%s\x1b[0m%s', error.message, imageUrl)
            })
          })
          .catch(error => {
            console.error(
              '\x1b[31m%s %s.\x1b[0m %s',
              'Download image failed.',
              error.message,
              imageUrl,
            )
            errorImageUrl.push({ url: imageUrl, path: `${boardPath}/${imageName}` })
          })
          .finally(cb)
      },
      (error: IError | undefined) => {
        if (error) {
          throw error
        }
        errorImageUrl.length && retry()
        resolve(downloadCount)
      },
    )
  })
}

async function getPinsAndDownload(board: IBoard): Promise<void> {
  const boardPins = await getPins(board.board_id)
  const missedPinsCount = board.pin_count - boardPins.length

  const boardPath = `${downloadPath}/${board.board_id} - ${board.title}`
  fs.emptyDirSync(boardPath)

  const downloadCount: number = await downloadImage(boardPins, boardPath)
  const failedCount: number = missedPinsCount - (board.pin_count - downloadCount)
  allDownloadCount += downloadCount

  console.log(
    `Done. 成功 %d 个，失败 ${failedCount ? '\x1b[31m%d\x1b[0m' : '%d'} 个${missedPinsCount &&
      '，丢失 \x1b[31m%d\x1b[0m 个'}`,
    downloadCount,
    failedCount,
    missedPinsCount,
  )
}

function outputResult() {
  console.log('\n\x1b[32m✅ All Done!\x1b[0m')
  console.log('共下载 \x1b[32m%d\x1b[0m 张图片', allDownloadCount)
  console.log('\x1b[33m')
  console.timeEnd('Total time')
  console.log('\x1b[0m')
  process.exit(0)
}

async function downloadBoardsOfUser(username: string): Promise<void> {
  console.time('Total time')
  const userBoards: IBoard[] = await getUserBoards(username)

  console.log('\n用户 [%s] 画板数量：%d', username, userBoards.length)

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
  const board = await getBoard(boardId)
  console.log('\n开始下载画板 %s - %s，图片数量：%d', boardId, board.title, board.pin_count)

  await getPinsAndDownload(board)
  outputResult()
}

function downloadBoardsOfUserOption(): void {
  rl.question('请输入地址栏中的用户名：', username => {
    if (!username) {
      console.log('用户名为空，请重新输入！')
      downloadBoardsOfUserOption()
    } else {
      rl.question('下载路径（默认 ./images/）：', path => {
        downloadPath = path || 'images'

        downloadBoardsOfUser(username)
      })
    }
  })
}

function downloadSingleBoardOption(): void {
  // 输入画板ID和下载路径
  rl.question('画板ID：', boardId => {
    if (!boardId) {
      console.log('画板ID为空，请重新输入！')
      downloadSingleBoardOption()
    } else {
      rl.question('下载路径（默认 ./images/）：', path => {
        downloadPath = path || 'images'

        downloadSingleBoard(boardId)
      })
    }
  })
}

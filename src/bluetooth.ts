// 引入错误处理函数，用于解析和处理各种蓝牙相关错误
import { resolveError } from "./errors";
// 引入日志管理相关函数，用于记录和管理操作日志
import { clearLogs, getLogs, isLogEmpty, log } from "./logger";
// 引入预定义的有效负载数据，用于与蓝牙设备进行通信
import { endEpilogue, baAck, offlinebombFix, startPrologue, endPrologue } from "./payloads";
// 引入用于生成特定响应数据的求解器函数
import { makeStartEpilogue, makeUnlockResponse } from "./solvers";
// 引入工具函数，用于将二进制数据转换为十六进制字符串
import { bufferToHexString } from "./utils";
// 引入蓝牙插件的相关功能，用于连接、断开连接、发送数据、订阅特征等操作
import { connect, disconnect as bleDisconnect, send, subscribe, startScan, BleDevice, stopScan } from '@mnlphlp/plugin-blec';
// 引入倒计时相关功能，用于启动和控制倒计时
import { startCountdown, CountdownController } from "./Countdown";

// 设备常量
// 定义目标蓝牙设备的地址
const DEVICE_ADDRESS = "6D:6C:00:02:73:63";
// 定义目标蓝牙设备的名称
const DEVICE_NAME = "Water36088";
// const SERVICE_UUID = "0000f1f0-0000-1000-8000-00805f9b34fb";
// 定义用于发送数据的特征UUID
const TXD_UUID = "0000f1f1-0000-1000-8000-00805f9b34fb";
// 定义用于接收数据的特征UUID
const RXD_UUID = "0000f1f2-0000-1000-8000-00805f9b34fb";

// 定义一个变量来存储当前连接的蓝牙设备
let bluetoothdevice: BleDevice;

// 状态变量
// 表示蓝牙连接是否已经启动
let isStarted = false;
// 表示是否启用自动重连功能
let autoReconnect = true;

// 解决新固件判断问题，见handleRxdNotifications
let pendingStartEpilogue: number; 
// 如果我们未能及时收到响应，应显示错误消息
let pendingTimeoutMessage: number; 
// 准备倒计时
let countdown: CountdownController; 

/**
 * 向指定的UUID发送数据，并记录日志。
 * @param value - 要发送的数据，类型为Uint8Array。
 */
async function writeValue(value: Uint8Array) {
  // 将发送的数据转换为十六进制字符串并记录日志
  const msg = "TXD: " + bufferToHexString(value);
  log(msg);
  // 记录正在向指定UUID发送数据的日志
  log(`正在向 ${TXD_UUID} 发送数据: ${msg}`);
  // 调用发送函数将数据发送到指定UUID
  await send(TXD_UUID, value);
}

/**
 * 根据不同的阶段更新UI显示。
 * @param stage - 阶段类型，可选值为 "pending"、"ok" 或 "standby"。
 */
function updateUi(stage: "pending" | "ok" | "standby") {
  // 获取主按钮元素
  const mainButton = document.getElementById("main-button")! as HTMLButtonElement;
  // 获取显示设备名称的元素
  const deviceName = document.getElementById("device-name")! as HTMLSpanElement;
  // 获取显示倒计时的元素
  const counterElement = document.getElementById("counter") as HTMLElement;
  // 记录正在更新UI到指定阶段的日志
  log(`正在将UI更新到阶段: ${stage}`);

  switch (stage) {
    case "pending":
      // 设置主按钮文本为“请稍候”
      mainButton.textContent = "请稍候";
      // 禁用主按钮
      mainButton.disabled = true;
      // 更新设备名称元素的文本，显示已连接的设备名称
      deviceName.textContent = "已连接：" + bluetoothdevice.name!;
      // 记录UI已设置为等待状态的日志
      log(`UI已设置为等待状态。按钮文本: ${mainButton.textContent}，设备名称: ${deviceName.textContent}`);
      // setupTimeoutMessage();
      break;
    case "ok":
      // 设置主按钮文本为“结束”
      mainButton.textContent = "结束";
      // 启用主按钮
      mainButton.disabled = false;
      // 记录UI已设置为正常状态的日志
      log(`UI已设置为正常状态。按钮文本: ${mainButton.textContent}`);
      // 开始倒计时，设置倒计时时间为420秒，指定倒计时显示元素，并定义倒计时结束后的回调函数
      countdown = startCountdown(420, counterElement, () => {
        console.log("时间到！");
        log("倒计时结束！");
      });
      // 记录倒计时已开始的日志
      log("倒计时已开始。");
      break;
    case "standby":
      // 设置主按钮文本为“开启”
      mainButton.textContent = "开启";
      // 启用主按钮
      mainButton.disabled = false;
      // 更新设备名称元素的文本，显示未连接状态
      deviceName.textContent = "未连接";
      // 记录UI已设置为待机状态的日志
      log(`UI已设置为待机状态。按钮文本: ${mainButton.textContent}，设备名称: ${deviceName.textContent}`);
      // 停止倒计时
      countdown.stop();
      // 记录倒计时已停止的日志
      log("倒计时已停止。");
      break;
  }
}

/**
 * 断开与蓝牙设备的连接，并处理相关状态和日志。
 */
async function disconnect() {
  // 记录正在启动断开连接流程的日志
  log("正在启动断开连接流程。");
  try {
    // 检查设备是否已连接
    if (bluetoothdevice && bluetoothdevice.isConnected) {
      // 记录设备已连接，正在断开连接的日志
      log("设备已连接。正在断开连接...");
      // 调用断开连接函数
      await bleDisconnect();
      // 记录设备已成功断开连接的日志
      log("设备已成功断开连接。");
    } else {
      // 记录设备已经断开连接的日志
      log("设备已经断开连接。");
    }
  } catch (error) {
    // 记录断开连接时出错的日志
    console.error("断开连接时出错:", error);
    log(`断开连接时出错: ${error}`);
  }
  // 将连接启动状态设置为false
  isStarted = false;
  // 记录已将isStarted设置为false的日志
  log("已将isStarted设置为false。");
  // 清除日志
  clearLogs();
  // 记录日志已清除的日志
  log("日志已清除。");
  // 清除pendingStartEpilogue超时
  clearTimeout(pendingStartEpilogue);
  // 记录已清除pendingStartEpilogue超时的日志
  log("已清除pendingStartEpilogue超时。");
  // 清除pendingTimeoutMessage超时
  clearTimeout(pendingTimeoutMessage);
  // 记录已清除pendingTimeoutMessage超时的日志
  log("已清除pendingTimeoutMessage超时。");
  // 将UI更新到待机状态
  updateUi("standby");
  // 记录已将UI更新到待机状态的日志
  log("已将UI更新到待机状态。");

  // 自动重连逻辑优化
  if (autoReconnect) {
    // 初始化当前重试次数为0
    let retries = 0; 

    const reconnect = async () => {
      try {
        // 记录自动重连尝试的日志
        log(`自动重连尝试 ${retries + 1}...`);
        // 调用启动函数进行重连
        await start();
        // 记录自动重连成功的日志
        log("自动重连成功。");
      } catch (reconnectError) {
        // 记录自动重连尝试失败的日志
        log(`自动重连尝试 ${retries + 1} 失败: ${reconnectError}`);
        // 增加重试次数
        retries++;
        // 计算下一次重试的延迟时间，采用指数退避策略
        const delay = Math.min(60000, 400 * Math.pow(2, retries)); 
        // 设置延迟后再次尝试重连
        setTimeout(reconnect, delay);
      }
    };

    // 记录自动重连已启用，正在启动流程的日志
    log("自动重连已启用。正在启动流程...");
    // 设置400毫秒后开始第一次重连尝试
    setTimeout(reconnect, 400);
  }
}
/**
 * 处理蓝牙连接过程中出现的错误，显示错误信息并处理重连逻辑。
 * @param error - 捕获到的错误对象。
 */
async function handleBluetoothError(error: unknown) {
  // 记录正在处理蓝牙错误的日志
  log(`正在处理蓝牙错误: ${error}`);
  // 获取对话框内容元素
  const dialogContent = document.getElementById("dialog-content")!;
  // 获取对话框调试容器元素
  const dialogDebugContainer = document.getElementById("dialog-debug-container")!;
  // 获取对话框调试内容元素
  const dialogDebugContent = document.getElementById("dialog-debug-content")!;

  // 调用错误解析函数，获取错误输出、是否为致命错误以及是否显示日志的信息
  const { output, isFatal, showLogs } = resolveError(error);
  // 调用错误输出函数，将错误信息显示在对话框中
  output(dialogContent, error);
  // 记录错误信息已显示在对话框中的日志
  log("错误信息已显示在对话框中。");

  // 初始隐藏调试容器
  dialogDebugContainer.style.display = "none";
  // 记录调试容器初始隐藏的日志
  log("调试容器初始隐藏。");
  // 检查日志是否不为空且需要显示日志
  if (!isLogEmpty() && showLogs) {
    // 显示调试容器
    dialogDebugContainer.style.display = "block";
    // 将日志内容显示在调试内容元素中
    dialogDebugContent.textContent = "调试信息：\n" + getLogs().join("\n");
    // 记录调试容器已显示日志的日志
    log("调试容器已显示日志。");
  }

  // 获取对话框元素
  const dialog = document.getElementById("dialog") as HTMLDialogElement;
  // 显示对话框
  dialog.showModal(); 
  // 记录错误对话框已显示的日志
  log("错误对话框已显示。");

  // 3秒后关闭对话框
  if (autoReconnect) {
    setTimeout(() => {
      // 关闭对话框
      dialog.close(); 
      // 记录错误对话框在3秒后已关闭的日志
      log("错误对话框在3秒后已关闭。");
    }, 3000);
  }

  // 检查是否为致命错误或启用了自动重连
  if (isFatal || autoReconnect) {
    // 记录错误为致命错误或自动重连已启用，正在启动断开连接流程的日志
    log("错误为致命错误或自动重连已启用。正在启动断开连接流程。");
    // 调用断开连接函数
    await disconnect();
  }
}

// RXD数据处理
// 用于存储最近接收到的数据及其出现次数
const recentDataMap = new Map<string, number>();
// 最大重复次数
const MAX_DUPLICATE_COUNT = 3;

/**
 * 处理接收到的RXD数据，根据数据类型进行不同的操作。
 * @param data - 接收到的RXD数据，类型为Uint8Array。
 */
async function handleRxdData(data: Uint8Array) {
  // 记录已接收到RXD数据的日志
  log("已接收到RXD数据。");
  // 将数据转换为十六进制字符串，作为Map的键
  const dataKey = bufferToHexString(data);
  // 记录已将RXD数据转换为键的日志
  log(`已将RXD数据转换为键: ${dataKey}`);
  // 获取当前数据的重复次数，若不存在则默认为0
  const currentCount = recentDataMap.get(dataKey) || 0;
  // 记录键的当前重复次数的日志
  log(`键 ${dataKey} 的当前重复次数: ${currentCount}`);

  // 如果重复次数达到最大限制，直接返回，不处理此次数据
  if (currentCount >= MAX_DUPLICATE_COUNT - 1) {
    // 记录键的重复次数已达到限制，忽略此数据的日志
    log(`键 ${dataKey} 的重复次数已达到限制。忽略此数据。`);
    return;
  }

  // 更新数据的重复次数
  recentDataMap.set(dataKey, currentCount + 1);
  // 记录已将键的重复次数更新的日志
  log(`已将键 ${dataKey} 的重复次数更新为 ${currentCount + 1}`);

  // 一段时间后清除记录，避免内存泄漏
  setTimeout(() => {
    // 从Map中删除键
    recentDataMap.delete(dataKey);
    // 记录5秒后已清除键的重复次数记录的日志
    log(`5秒后已清除键 ${dataKey} 的重复次数记录。`);
  }, 5000);

  // console.log("RXD: \ntype: "+typeof(data)+" \ncontent: " + data);
  // 记录接收到的RXD数据的十六进制字符串表示
  log("RXD: " + bufferToHexString(data));
  // const dType = data[3];

  try {
    // 从接收到的数据创建Uint8Array有效负载
    let payload = new Uint8Array(data);
    // 记录已从RXD数据创建Uint8Array有效负载的日志
    log("已从RXD数据创建Uint8Array有效负载。");

    // 由于固件中的一个错误，它可能会通过RXD发送一个AT命令 "AT+STAS?"；它不以FDFD09开头
    if (payload[0] === 0x41 && payload[1] === 0x54 && payload[2] === 0x2b) {
      // 记录已接收到AT命令，忽略此数据的日志
      log("已接收到AT命令。忽略此数据。");
      return;
    }

    // 检查有效负载的第一个字节是否为0xfd或0x09
    if (payload[0] !== 0xfd && payload[0] !== 0x09) {
      // 记录已接收到未知的RXD数据，抛出错误的日志
      log("已接收到未知的RXD数据。抛出错误。");
      throw new Error("WATERCTL内部未知的RXD数据");
    }

    // 有时，由于固件实现不佳，前一两个字节可能会丢失
    // 解释: [0xFD, 0x09, ...] => [0xFD, 0xFD, 0x09, ...]
    if (payload[1] === 0x09) {
      // 向有效负载添加缺失的字节
      payload = new Uint8Array([0xfd, ...payload]);
      // 记录已向有效负载添加缺失的字节的日志
      log("已向有效负载添加缺失的字节。");
    }

    // 解释: [0x09, ...] => [0xFD, 0xFD, 0x09, ...]
    if (payload[0] === 0x09) {
      // 向有效负载添加两个缺失的字节
      payload = new Uint8Array([0xfd, 0xfd, ...payload]);
      // 记录已向有效负载添加两个缺失的字节的日志
      log("已向有效负载添加两个缺失的字节。");
    }

    // ... 有时它会发送一个单字节0xFD
    if (payload.length < 4) {
      // 记录已接收到单字节有效负载，忽略此数据的日志
      log("已接收到单字节有效负载。忽略此数据。");
      return;
    }

    // 获取数据类型
    const dType = payload[3];
    // 记录已确定数据类型的日志
    log(`已确定数据类型: ${dType}`);

    // https://github.com/prettier/prettier/issues/5158
    // prettier-ignore
    switch (dType) {
      case 0xB0:
      case 0xB1:
        // 清除pendingStartEpilogue超时
        clearTimeout(pendingStartEpilogue);
        // 记录已清除pendingStartEpilogue超时的日志
        log("已清除pendingStartEpilogue超时。");
        // 设置新的发送开始结语的超时
        pendingStartEpilogue = window.setTimeout(async () => {
          // 记录正在启动发送开始结语的超时的日志
          log("正在启动发送开始结语的超时。");
          // 调用writeValue函数发送开始结语
          await writeValue(makeStartEpilogue(DEVICE_NAME));
        }, 500);
        // 记录已设置新的发送开始结语的超时的日志
        log("已设置新的发送开始结语的超时。");
        break;
      case 0xAE:
        // 清除pendingStartEpilogue超时
        clearTimeout(pendingStartEpilogue);
        // 记录已清除pendingStartEpilogue超时的日志
        log("已清除pendingStartEpilogue超时。");
        // 调用writeValue函数发送解锁响应
        await writeValue(await makeUnlockResponse(data, DEVICE_NAME));
        // 记录已发送解锁响应的日志
        log("已发送解锁响应。");
        break;
      case 0xAF:
        switch (data[5]) {
          case 0x55:
            // 调用writeValue函数发送带有true标志的开始结语
            await writeValue(makeStartEpilogue(DEVICE_NAME, true));
            // 记录已发送带有true标志的开始结语的日志
            log("已发送带有true标志的开始结语。");
            break;
          case 0x01: // 密钥认证失败；"err41" (错误的密钥)
          case 0x02: // ?
          case 0x04: // "err43" (错误的随机数)
            // 记录已接收到错误的密钥错误，抛出错误的日志
            log("已接收到错误的密钥错误。抛出错误。");
            throw new Error("WATERCTL内部错误的密钥");
          default:
            // 调用writeValue函数发送带有true标志的开始结语
            await writeValue(makeStartEpilogue(DEVICE_NAME, true));
            // 记录已为未知数据发送带有true标志的开始结语的日志
            log("已为未知数据发送带有true标志的开始结语。");
            throw new Error("WATERCTL内部未知的RXD数据");
        }
        break;
      case 0xB2:
        // 清除pendingStartEpilogue超时
        clearTimeout(pendingStartEpilogue);
        // 记录已清除pendingStartEpilogue超时的日志
        log("已清除pendingStartEpilogue超时。");
        // 清除pendingTimeoutMessage超时
        clearTimeout(pendingTimeoutMessage);
        // 记录已清除pendingTimeoutMessage超时的日志
        log("已清除pendingTimeoutMessage超时。");
        // 将连接启动状态设置为true
        isStarted = true;
        // 记录已将isStarted设置为true的日志
        log("已将isStarted设置为true。");
        // 将UI更新到正常状态
        updateUi("ok");
        // 记录已将UI更新到正常状态的日志
        log("已将UI更新到正常状态。");
        break;
      case 0xB3:
        // 调用writeValue函数发送结束结语
        await writeValue(endEpilogue);
        // 记录已发送结束结语的日志
        log("已发送结束结语。");
        // 调用断开连接函数
        await disconnect();
        // 记录正在启动断开连接流程的日志
        log("正在启动断开连接流程。");
        break;
      case 0xBA:
        // 调用writeValue函数发送BA确认
        await writeValue(baAck);
        // 记录已发送BA确认的日志
        log("已发送BA确认。");
        break;
      case 0xBC:
        // 调用writeValue函数发送离线炸弹修复
        await writeValue(offlinebombFix);
        // 记录已发送离线炸弹修复的日志
        log("已发送离线炸弹修复。");
        break;
      case 0xC8:
        // 记录已接收到拒绝错误，抛出错误的日志
        log("已接收到拒绝错误。抛出错误。");
        throw new Error("WATERCTL内部拒绝");
      case 0xAA:// 不知道是什么，总是在第一次连接的时候出现
        // 记录未处理的RXD类型的警告信息
        console.warn("未处理的RXD类型:", dType);
        // 记录已接收到未处理的RXD类型的日志
        log(`已接收到未处理的RXD类型 ${dType}。`);
        break;
      default:
        // console.warn("未处理的RXD类型:", dType);
        // 记录已接收到未知的RXD数据类型，抛出错误的日志
        log(`已接收到未知的RXD数据类型 ${dType}。抛出错误。`);
        throw new Error("WATERCTL内部未知的RXD数据");
    }
  } catch (error) {
    // 调用错误处理函数处理错误
    handleBluetoothError(error);
  }
}

/**
 * 设置超时消息，若在规定时间内未收到响应则处理超时错误。
 */
function setupTimeoutMessage() {
  // 检查是否已经设置了超时消息
  if (!pendingTimeoutMessage) {
    // 记录正在设置超时消息的日志
    log("正在设置超时消息。");
    // 设置15秒的超时消息
    pendingTimeoutMessage = window.setTimeout(() => {
      // 记录操作已超时，正在处理错误的日志
      log("操作已超时。正在处理错误。");
      // 调用错误处理函数处理超时错误
      handleBluetoothError("WATERCTL内部操作超时");
    }, 15000);
    // 记录已设置15秒的超时消息的日志
    log("已设置15秒的超时消息。");
  }
}

/**
 * 启动蓝牙设备扫描和连接流程。
 */
let isScanning = false;
async function start() {
  // 检查是否正在扫描
  if (isScanning) {
    // 记录正在扫描中，跳过启动的日志
    log("正在扫描中。跳过启动。");
    return;
  }
  try {
    // 设置扫描状态为正在扫描
    isScanning = true;
    // 记录正在启动设备扫描的日志
    log("正在启动设备扫描。");
    console.log("正在开始扫描");
    // 启动扫描，设置扫描结果的回调函数和扫描超时时间
    startScan(async (devices: BleDevice[]) => {
      // 记录已收到扫描结果的日志
      log("已收到扫描结果。");
      for (const device of devices) {
        // 记录正在检查设备的日志
        log(`正在检查设备: ${device.name}`);
        // 使用设备地址和名称进行匹配
        if (device.name === KB520011b5E || device.address === B520011b5E) {
          // 记录已找到目标设备的日志
          log(`已找到目标设备: ${device.name}`);
          console.log("已找到设备:", device);
          // 记录正在停止扫描的日志
          log("正在停止扫描...");
          // 停止扫描
          stopScan();
          // 记录扫描已成功停止的日志
          log("扫描已成功停止。");
          // 将找到的设备赋值给bluetoothdevice变量
          bluetoothdevice = device;
          // 记录已将bluetoothdevice设置为找到的设备的日志
          log(`已将bluetoothdevice设置为 ${device.name}`);
          // 记录正在将UI更新到等待状态的日志
          log("正在将UI更新到等待状态...");
          // 将UI更新到等待状态
          updateUi("pending");
          // 记录已成功将UI更新到等待状态的日志
          log("已成功将UI更新到等待状态。");
          try {
            // 记录正在尝试连接到设备的日志
            log(`正在尝试连接到设备: ${device.name}，地址为 ${device.address}...`);
            // 调用连接函数连接到设备，并设置断开连接的回调函数
            await connect(device.address, () => {
              console.log("已断开连接");
              // 记录设备已断开连接，正在启动断开连接流程的日志
              log("设备已断开连接。正在启动断开连接流程。");
              // 调用断开连接函数
              disconnect();
            });
            // 记录已成功连接到设备的日志
            log("已成功连接到设备。");
          } catch (connectError) {
            // 记录连接到设备失败的日志
            log(`连接到设备失败: ${connectError}`);
            // 调用错误处理函数处理连接错误
            handleBluetoothError(connectError);
            // 设置扫描状态为未扫描
            isScanning = false;
            return;
          }
          // 订阅RXD特征
          try {
            // 记录正在尝试订阅RXD UUID的日志
            log(`正在尝试订阅RXD UUID ${RXD_UUID}...`);
            // 调用订阅函数订阅RXD UUID，并设置数据处理回调函数
            await subscribe(RXD_UUID, handleRxdData);
            // 记录已成功订阅RXD UUID的日志
            log(`已成功订阅RXD UUID ${RXD_UUID}。`);
          } catch (subscribeError) {
            // 记录订阅RXD UUID失败的日志
            log(`订阅RXD UUID失败: ${subscribeError}`);
            // 调用错误处理函数处理订阅错误
            handleBluetoothError(subscribeError);
            // 调用断开连接函数
            await disconnect();
            // 设置扫描状态为未扫描
            isScanning = false;
            return;
          }

          // 发送启动序章
          try {
            // 记录正在尝试向TXD UUID发送启动序章的日志
            log(`正在尝试向TXD UUID ${TXD_UUID} 发送启动序章...`);
            // 调用发送函数向TXD UUID发送启动序章
            await send(TXD_UUID, startPrologue);
            // 记录已成功向TXD UUID发送启动序章的日志
            log(`已成功向TXD UUID ${TXD_UUID} 发送启动序章。`);
          } catch (sendError) {
            // 记录发送启动序章失败的日志
            log(`发送启动序章失败: ${sendError}`);
            // 调用错误处理函数处理发送错误
            handleBluetoothError(sendError);
            // 调用断开连接函数
            await disconnect();
            // 设置扫描状态为未扫描
            isScanning = false;
            return;
          }
          // 记录正在设置超时消息的日志
          log("正在设置超时消息...");
          // 调用设置超时消息函数
          setupTimeoutMessage();
          // 记录已成功设置超时消息的日志
          log("已成功设置超时消息。");
          break;
        }
      }
      // 设置扫描状态为未扫描
      isScanning = false;
      // 记录扫描流程已完成的日志
      log("扫描流程已完成。");
    }, 15000);

    // 直接连接指定设备
    // await connect(DEVICE_ADDRESS, () => {
    //   console.log("Disconnected");
    //   disconnect();
    // });

  } catch (error) {
    // 调用错误处理函数处理扫描错误
    handleBluetoothError(error);
    // 设置扫描状态为未扫描
    isScanning = false;
    // 记录扫描失败，正在处理错误并将isScanning设置为false的日志
    log("扫描失败。正在处理错误并将isScanning设置为false。");
  }
}

/**
 * 结束当前的蓝牙连接流程。
 */
async function end() {
  try {
    // 记录正在启动结束流程的日志
    log("正在启动结束流程。");
    // 调用writeValue函数向TXD UUID发送结束序章
    await writeValue(endPrologue);
    // 记录已向TXD UUID发送结束序章的日志
    log(`已向TXD UUID ${TXD_UUID} 发送结束序章。`);
    // 调用设置超时消息函数
    setupTimeoutMessage();
    // 记录已设置超时消息的日志
    log("已设置超时消息。");
  } catch (error) {
    // 调用错误处理函数处理结束流程中的错误
    handleBluetoothError(error);
    // 记录结束流程中出错，正在处理错误的日志
    log("结束流程中出错。正在处理错误。");
  }
}

/**
 * 处理按钮点击事件，根据当前状态启动或结束蓝牙连接流程。
 */
export function handleButtonClick() {
  // 检查连接是否已经启动
  if (isStarted) {
    // 记录启动状态下按钮被点击，正在启动结束流程的日志
    log("启动状态下按钮被点击。正在启动结束流程。");
    // 调用结束函数
    end();
  } else {
    // 记录未启动状态下按钮被点击，正在启动启动流程的日志
    log("未启动状态下按钮被点击。正在启动启动流程。");
    // 调用启动函数
    start();
  }
}

// 自动重连
// document.addEventListener("DOMContentLoaded", () => {
//   if (autoReconnect) {
//     setInterval(() => {
//       const mainButton = document.getElementById("main-button") as HTMLButtonElement;
//       if (mainButton.innerText == "开启") {
//         start();
//       }
//     }, 5000);
//   }
// });

// ==UserScript==
// @name         Shopee工具-地址提取模块
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  负责根据return_id提取地址和识别仓库
// @author       You
// @require      utils.js
// ==/UserScript==

/**
 * 地址提取模块
 * 功能：
 * 1. 根据return_id打开订单页面
 * 2. 提取退货地址信息
 * 3. 识别仓库代码（BI SMR/BI SBY/BI JKT）
 * 4. 缓存提取结果
 */
const AddressExtractor = {
    // 配置
    config: {
        maxConcurrent: 3,     // 最大并发数
        timeout: 30000,       // 超时时间
        retryCount: 2         // 重试次数
    },

    // 仓库识别规则
    warehouseRules: {
        '50121': 'BI SMR',  // Semarang
        '61254': 'BI SBY',  // Surabaya
        '14460': 'BI JKT'   // Jakarta
    },

    // 缓存
    cache: {
        results: new Map(),   // 提取结果映射
        processing: new Set() // 正在处理的ID
    },

    /**
     * 识别仓库代码
     * @param {string} address - 地址字符串
     * @returns {string} 仓库代码
     */
    identifyWarehouse(address) {
        if (!address) return '未知';

        for (const [postalCode, warehouseCode] of Object.entries(this.warehouseRules)) {
            if (address.includes(postalCode)) {
                return warehouseCode;
            }
        }

        return '其他';
    },

    /**
     * 提取单个订单的地址
     * @param {string} returnSn - Return SN
     * @param {string} returnId - Return ID
     * @returns {Promise<Object>} 提取结果
     */
    async extractAddress(returnSn, returnId) {
        return new Promise((resolve) => {
            const url = `https://seller.shopee.co.id/portal/sale/return/${returnId}`;
            const windowName = `addr_${returnSn}_${Date.now()}`;
            
            ShopeeUtils.log(`开始提取地址: ${returnSn} (ID: ${returnId})`, 'info');
            
            // 打开新窗口
            const newWindow = window.open(url, windowName, 'width=800,height=600,noopener,noreferrer');
            
            if (!newWindow) {
                ShopeeUtils.addLogToUI(`窗口被阻止: ${returnSn}`, 'error');
                resolve({
                    success: false,
                    return_sn: returnSn,
                    return_id: returnId,
                    address: '窗口被阻止',
                    warehouse: '未知',
                    timestamp: new Date().toLocaleString()
                });
                return;
            }

            // 标记为正在处理
            this.cache.processing.add(returnId);

            // 设置超时
            const timeoutId = setTimeout(() => {
                if (this.cache.processing.has(returnId)) {
                    ShopeeUtils.addLogToUI(`提取超时: ${returnSn}`, 'error');
                    this.cache.processing.delete(returnId);
                    
                    try {
                        if (!newWindow.closed) {
                            newWindow.close();
                        }
                    } catch (e) {
                        // 忽略关闭错误
                    }

                    resolve({
                        success: false,
                        return_sn: returnSn,
                        return_id: returnId,
                        address: '提取超时',
                        warehouse: '未知',
                        timestamp: new Date().toLocaleString()
                    });
                }
            }, this.config.timeout);

            // 监听消息
            const messageHandler = (event) => {
                // 验证消息来源
                if (event.data && event.data.type === 'SHOPEE_ADDRESS_EXTRACTED') {
                    const data = event.data;
                    
                    if (data.orderId === returnId) {
                        clearTimeout(timeoutId);
                        this.cache.processing.delete(returnId);
                        window.removeEventListener('message', messageHandler);

                        const warehouse = this.identifyWarehouse(data.address);
                        
                        const result = {
                            success: data.success,
                            return_sn: returnSn,
                            return_id: returnId,
                            address: data.address || '未找到地址',
                            warehouse: warehouse,
                            timestamp: new Date().toLocaleString()
                        };

                        // 缓存结果
                        this.cache.results.set(returnSn, result);

                        if (data.success) {
                            ShopeeUtils.log(`提取成功: ${returnSn} -> ${warehouse}`, 'success');
                        } else {
                            ShopeeUtils.log(`提取失败: ${returnSn}`, 'error');
                        }

                        // 关闭窗口
                        try {
                            if (!newWindow.closed) {
                                newWindow.close();
                            }
                        } catch (e) {
                            // 忽略关闭错误
                        }

                        resolve(result);
                    }
                }
            };

            window.addEventListener('message', messageHandler);
        });
    },

    /**
     * 批量提取地址
     * @param {Array} matchedResults - 匹配的结果数组 [{return_sn, return_id}, ...]
     * @param {Function} progressCallback - 进度回调函数
     * @returns {Promise<Array>} 提取结果数组
     */
    async extractAddresses(matchedResults, progressCallback) {
        if (!matchedResults || matchedResults.length === 0) {
            ShopeeUtils.showError('没有要处理的订单');
            return [];
        }

        ShopeeUtils.addLogToUI(`开始批量提取地址，共 ${matchedResults.length} 个订单`, 'info');
        
        const results = [];
        const queue = [...matchedResults];
        const processing = [];

        const processNext = async () => {
            while (queue.length > 0 && processing.length < this.config.maxConcurrent) {
                const item = queue.shift();
                
                const promise = this.extractAddress(item.return_sn, item.return_id)
                    .then(result => {
                        results.push(result);
                        
                        // 更新进度
                        if (progressCallback) {
                            progressCallback({
                                total: matchedResults.length,
                                completed: results.length,
                                current: result
                            });
                        }

                        ShopeeUtils.addLogToUI(
                            `[${results.length}/${matchedResults.length}] ${result.return_sn}: ${result.warehouse}`,
                            result.success ? 'success' : 'error'
                        );

                        // 从处理队列中移除
                        const index = processing.indexOf(promise);
                        if (index > -1) {
                            processing.splice(index, 1);
                        }

                        // 继续处理下一个
                        return processNext();
                    });

                processing.push(promise);
            }

            if (processing.length > 0) {
                await Promise.all(processing);
            }
        };

        await processNext();

        ShopeeUtils.addLogToUI(`地址提取完成！成功: ${results.filter(r => r.success).length}/${results.length}`, 'success');
        
        return results;
    },

    /**
     * 获取缓存的结果
     * @param {string} returnSn - Return SN
     * @returns {Object|null}
     */
    getCachedResult(returnSn) {
        return this.cache.results.get(returnSn) || null;
    },

    /**
     * 获取所有缓存的结果
     * @returns {Array}
     */
    getAllCachedResults() {
        return Array.from(this.cache.results.values());
    },

    /**
     * 清空缓存
     */
    clearCache() {
        this.cache.results.clear();
        this.cache.processing.clear();
        ShopeeUtils.addLogToUI('地址提取缓存已清空', 'info');
    },

    /**
     * 获取缓存信息
     * @returns {Object}
     */
    getCacheInfo() {
        const results = Array.from(this.cache.results.values());
        const successCount = results.filter(r => r.success).length;
        
        return {
            totalResults: results.length,
            successCount: successCount,
            failCount: results.length - successCount,
            processingCount: this.cache.processing.size,
            successRate: results.length > 0 
                ? (successCount / results.length * 100).toFixed(1) + '%'
                : '0%'
        };
    }
};

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AddressExtractor;
}


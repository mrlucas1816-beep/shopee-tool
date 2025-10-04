// ==UserScript==
// @name         Shopee工具-订单爬取模块
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  负责日期范围内的订单爬取、数据筛选和缓存
// @author       You
// @require      utils.js
// @grant        GM_xmlhttpRequest
// ==/UserScript==

/**
 * 订单爬取模块
 * 功能：
 * 1. 根据日期范围爬取订单数据
 * 2. 过滤无效数据（return_sn为0或空）
 * 3. 只保留return_id和return_sn字段
 * 4. 缓存爬取结果
 */
const OrderCrawler = {
    // 配置
    config: {
        api: 'https://seller.shopee.co.id/api/v4/seller_center/return/return_list/get_exceptional_case_list',
        pageSize: 50,
        maxRetries: 3,
        retryDelay: 2000
    },

    // 缓存
    cache: {
        rawData: [],      // 原始数据
        filteredData: [], // 过滤后的数据
        snToIdMap: new Map(), // SN到ID的映射
        lastUpdate: null   // 最后更新时间
    },

    // 认证头部
    authHeaders: {},

    /**
     * 获取认证信息
     * @returns {Promise<Object>}
     */
    async getAuthHeaders() {
        return new Promise((resolve) => {
            ShopeeUtils.addLogToUI('正在获取认证信息...', 'info');

            // 拦截fetch请求获取认证信息
            const originalFetch = window.fetch;
            let captured = false;

            window.fetch = function(...args) {
                const [url, options] = args;
                
                if (url.includes('seller_center') || url.includes('return_list') || url.includes('get_exceptional_case_list')) {
                    if (options?.headers) {
                        OrderCrawler.authHeaders = { ...options.headers };
                        captured = true;
                        ShopeeUtils.addLogToUI('已获取认证信息', 'success');
                    }
                }
                return originalFetch.apply(this, args);
            };

            // 超时使用默认头部
            setTimeout(() => {
                if (!captured) {
                    const csrfToken = ShopeeUtils.getCsrfToken();
                    OrderCrawler.authHeaders = {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    };
                    
                    if (csrfToken) {
                        OrderCrawler.authHeaders['X-CSRFToken'] = csrfToken;
                        ShopeeUtils.addLogToUI('已添加 CSRF Token', 'info');
                    }
                    
                    ShopeeUtils.addLogToUI('使用默认认证信息', 'warning');
                }
                
                window.fetch = originalFetch;
                resolve(OrderCrawler.authHeaders);
            }, 3000);
        });
    },

    /**
     * 获取选择的日期范围
     * @returns {Object|null} {lower_value, upper_value}
     */
    getSelectedDateRange() {
        const startDateInput = document.getElementById('start-date');
        const endDateInput = document.getElementById('end-date');

        if (!startDateInput || !endDateInput || !startDateInput.value || !endDateInput.value) {
            ShopeeUtils.showError('请选择开始和结束日期');
            return null;
        }

        // 正确解析日期
        const startDate = new Date(startDateInput.value + 'T00:00:00');
        const endDate = new Date(endDateInput.value + 'T23:59:59');

        // 验证日期是否有效
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            ShopeeUtils.showError('日期格式无效，请重新选择');
            return null;
        }

        const startTimestamp = Math.floor(startDate.getTime() / 1000);
        const endTimestamp = Math.floor(endDate.getTime() / 1000);

        ShopeeUtils.addLogToUI(`选择日期范围: ${startDateInput.value} 到 ${endDateInput.value}`, 'info');
        ShopeeUtils.addLogToUI(`时间戳范围: ${startTimestamp} 到 ${endTimestamp}`, 'info');

        return {
            lower_value: startTimestamp,
            upper_value: endTimestamp
        };
    },

    /**
     * 获取单页数据
     * @param {number} pageNumber - 页码
     * @param {number|null} offset - 偏移量
     * @param {Object} dateRange - 日期范围
     * @returns {Promise<Object>}
     */
    fetchPageData(pageNumber, offset, dateRange) {
        return new Promise((resolve, reject) => {
            const payload = {
                "language": "id",
                "is_reverse_sorting_order": false,
                "page_number": pageNumber,
                "page_size": this.config.pageSize,
                "keyword": null,
                "pending_action": null,
                "request_solution": null,
                "forward_logistics_statuses": [],
                "reverse_logistics_statuses": [],
                "return_reasons": [],
                "create_time_range": dateRange,
                "compensation_amount_option": null,
                "seller_request_statuses": [],
                "validation_type_option": null,
                "request_adjusted": null,
                "advanced_fulfilment_option": null,
                "refund_amount_range": {
                    "lower_value": null,
                    "upper_value": null
                },
                "flow_tab": 1,
                "case_tab": 0,
                "sorting_field": 1,
                "key_action_due_time_range": {
                    "lower_value": null,
                    "upper_value": null
                },
                "platform_type": "sc"
            };

            // 添加cursor信息
            if (offset !== null && offset !== 0) {
                payload.cursor = {
                    "cursor_type": 1,
                    "cursor_offset": offset
                };
            }

            GM_xmlhttpRequest({
                method: 'POST',
                url: this.config.api,
                headers: {
                    'Content-Type': 'application/json',
                    ...this.authHeaders
                },
                data: JSON.stringify(payload),
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        
                        if (data.error && data.error !== 0) {
                            reject(new Error(data.error_msg || 'API返回错误'));
                        } else {
                            resolve(data);
                        }
                    } catch (e) {
                        reject(new Error('解析响应数据失败'));
                    }
                },
                onerror: () => reject(new Error('网络请求失败'))
            });
        });
    },

    /**
     * 过滤有效数据
     * @param {Array} dataArray - 原始数据数组
     * @returns {Array} 过滤后的数据
     */
    filterValidData(dataArray) {
        if (!Array.isArray(dataArray)) {
            return [];
        }

        const validData = dataArray.filter(item => {
            // 检查return_id和return_sn是否存在且有效
            return item &&
                   item.return_id !== null &&
                   item.return_id !== undefined &&
                   item.return_id !== '' &&
                   item.return_id !== 0 &&
                   item.return_sn !== null &&
                   item.return_sn !== undefined &&
                   item.return_sn !== '' &&
                   item.return_sn !== 0;
        }).map(item => ({
            // 只保留return_id和return_sn
            return_id: item.return_id,
            return_sn: item.return_sn
        }));

        const filteredCount = dataArray.length - validData.length;
        if (filteredCount > 0) {
            ShopeeUtils.addLogToUI(`过滤掉 ${filteredCount} 条无效数据`, 'warning');
        }

        return validData;
    },

    /**
     * 爬取订单数据
     * @returns {Promise<Array>} 过滤后的数据数组
     */
    async crawlOrders() {
        try {
            // 1. 获取认证信息
            await this.getAuthHeaders();

            // 2. 获取日期范围
            const dateRange = this.getSelectedDateRange();
            if (!dateRange) {
                throw new Error('日期范围无效');
            }

            // 3. 开始爬取
            ShopeeUtils.addLogToUI('开始爬取订单数据...', 'info');
            
            let allData = [];
            let currentPage = 1;
            let hasMoreData = true;
            let currentOffset = 0;

            while (hasMoreData) {
                ShopeeUtils.addLogToUI(`正在爬取第 ${currentPage} 页...`, 'info');

                try {
                    const data = await this.fetchPageData(currentPage, currentOffset, dateRange);

                    // 解析响应数据
                    let responseData = null;
                    let paginationInfo = null;

                    if (data && data.data && data.data.exceptional_case_list) {
                        responseData = data.data.exceptional_case_list;
                    } else if (data && data.data && Array.isArray(data.data)) {
                        responseData = data.data;
                    }

                    // 检查分页信息
                    if (data && data.pagination_info) {
                        paginationInfo = data.pagination_info;
                        hasMoreData = paginationInfo.has_more || false;
                        currentOffset = paginationInfo.cursor?.cursor_offset || (currentPage * this.config.pageSize);
                    }

                    // 处理数据
                    if (responseData && Array.isArray(responseData) && responseData.length > 0) {
                        allData = allData.concat(responseData);
                        ShopeeUtils.addLogToUI(`第 ${currentPage} 页获取到 ${responseData.length} 条数据`, 'success');

                        // 如果API明确表示没有更多数据，停止爬取
                        if (paginationInfo && paginationInfo.has_more === false) {
                            ShopeeUtils.addLogToUI('API返回has_more=false，停止爬取', 'info');
                            break;
                        }
                    } else {
                        ShopeeUtils.addLogToUI(`第 ${currentPage} 页返回空数据，停止爬取`, 'info');
                        break;
                    }

                    currentPage++;
                    await ShopeeUtils.sleep(1000); // 延迟避免请求过快

                } catch (error) {
                    ShopeeUtils.addLogToUI(`第 ${currentPage} 页爬取失败: ${error.message}`, 'error');
                    break;
                }
            }

            // 4. 过滤和缓存数据
            ShopeeUtils.addLogToUI(`爬取完成！共获取 ${allData.length} 条原始数据`, 'success');
            
            const filteredData = this.filterValidData(allData);
            ShopeeUtils.addLogToUI(`过滤后有效数据: ${filteredData.length} 条`, 'success');

            // 更新缓存
            this.cache.rawData = allData;
            this.cache.filteredData = filteredData;
            this.cache.lastUpdate = Date.now();

            // 建立映射
            this.cache.snToIdMap.clear();
            filteredData.forEach(item => {
                this.cache.snToIdMap.set(item.return_sn, item.return_id);
            });

            ShopeeUtils.addLogToUI(`建立映射关系: ${this.cache.snToIdMap.size} 个`, 'success');

            return filteredData;

        } catch (error) {
            ShopeeUtils.showError(`订单爬取失败: ${error.message}`);
            throw error;
        }
    },

    /**
     * 获取缓存数据
     * @returns {Array}
     */
    getCachedData() {
        return this.cache.filteredData;
    },

    /**
     * 获取缓存映射
     * @returns {Map}
     */
    getCachedMap() {
        return this.cache.snToIdMap;
    },

    /**
     * 清空缓存
     */
    clearCache() {
        this.cache.rawData = [];
        this.cache.filteredData = [];
        this.cache.snToIdMap.clear();
        this.cache.lastUpdate = null;
        ShopeeUtils.addLogToUI('缓存已清空', 'info');
    },

    /**
     * 获取缓存信息
     * @returns {Object}
     */
    getCacheInfo() {
        return {
            rawDataCount: this.cache.rawData.length,
            filteredDataCount: this.cache.filteredData.length,
            mappingCount: this.cache.snToIdMap.size,
            lastUpdate: this.cache.lastUpdate ? new Date(this.cache.lastUpdate).toLocaleString() : '无'
        };
    }
};

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OrderCrawler;
}


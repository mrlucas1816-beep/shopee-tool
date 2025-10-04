// ==UserScript==
// @name         Shopee工具-Return SN匹配模块
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  负责用户输入的return_sn与爬取数据的匹配
// @author       You
// @require      utils.js
// ==/UserScript==

/**
 * Return SN 匹配模块
 * 功能：
 * 1. 解析用户输入的return_sn列表
 * 2. 与OrderCrawler获取的数据进行匹配
 * 3. 返回匹配的return_id列表
 * 4. 缓存匹配结果
 */
const SNMatcher = {
    // 缓存
    cache: {
        userInput: [],        // 用户输入的SN列表
        matchedResults: [],   // 匹配成功的结果
        unmatchedSns: [],     // 未匹配的SN列表
        snToIdMap: new Map()  // 匹配的映射关系
    },

    /**
     * 解析用户输入
     * @param {string} input - 用户输入的文本
     * @returns {Array} Return SN数组
     */
    parseUserInput(input) {
        if (!input || typeof input !== 'string') {
            ShopeeUtils.showError('请输入有效的Return SN');
            return [];
        }

        // 按行分割并清理
        const lines = input.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        // 验证格式
        const validSns = [];
        const invalidSns = [];

        lines.forEach(line => {
            if (ShopeeUtils.validateReturnSn(line)) {
                validSns.push(line);
            } else {
                invalidSns.push(line);
            }
        });

        if (invalidSns.length > 0) {
            ShopeeUtils.addLogToUI(`发现 ${invalidSns.length} 个格式无效的SN，已忽略`, 'warning');
            ShopeeUtils.log(`无效SN: ${invalidSns.join(', ')}`, 'warning');
        }

        if (validSns.length === 0) {
            ShopeeUtils.showError('没有找到有效的Return SN');
            return [];
        }

        ShopeeUtils.addLogToUI(`解析到 ${validSns.length} 个有效的Return SN`, 'success');
        this.cache.userInput = validSns;
        
        return validSns;
    },

    /**
     * 匹配Return SN
     * @param {Array} userSns - 用户输入的SN数组
     * @param {Map} crawledMap - 从OrderCrawler获取的映射
     * @returns {Object} 匹配结果
     */
    matchReturnSns(userSns, crawledMap) {
        if (!userSns || userSns.length === 0) {
            ShopeeUtils.showError('没有要匹配的Return SN');
            return {
                matched: [],
                unmatched: [],
                matchRate: 0
            };
        }

        if (!crawledMap || crawledMap.size === 0) {
            ShopeeUtils.showError('没有可用的订单数据，请先爬取订单');
            return {
                matched: [],
                unmatched: userSns,
                matchRate: 0
            };
        }

        ShopeeUtils.addLogToUI('开始匹配Return SN...', 'info');

        const matchedResults = [];
        const unmatchedSns = [];

        userSns.forEach(sn => {
            if (crawledMap.has(sn)) {
                const returnId = crawledMap.get(sn);
                matchedResults.push({
                    return_sn: sn,
                    return_id: returnId
                });
                this.cache.snToIdMap.set(sn, returnId);
                ShopeeUtils.log(`匹配成功: ${sn} -> ${returnId}`, 'success');
            } else {
                unmatchedSns.push(sn);
                ShopeeUtils.log(`未找到匹配: ${sn}`, 'warning');
            }
        });

        const matchRate = (matchedResults.length / userSns.length * 100).toFixed(1);

        // 更新缓存
        this.cache.matchedResults = matchedResults;
        this.cache.unmatchedSns = unmatchedSns;

        // 输出匹配结果
        ShopeeUtils.addLogToUI(`匹配完成！`, 'success');
        ShopeeUtils.addLogToUI(`匹配成功: ${matchedResults.length} 个`, 'success');
        ShopeeUtils.addLogToUI(`未匹配: ${unmatchedSns.length} 个`, unmatchedSns.length > 0 ? 'warning' : 'info');
        ShopeeUtils.addLogToUI(`匹配率: ${matchRate}%`, 'info');

        if (unmatchedSns.length > 0 && unmatchedSns.length <= 5) {
            ShopeeUtils.addLogToUI(`未匹配的SN: ${unmatchedSns.join(', ')}`, 'warning');
        } else if (unmatchedSns.length > 5) {
            ShopeeUtils.addLogToUI(`未匹配的SN: ${unmatchedSns.slice(0, 5).join(', ')}...`, 'warning');
        }

        return {
            matched: matchedResults,
            unmatched: unmatchedSns,
            matchRate: parseFloat(matchRate)
        };
    },

    /**
     * 获取匹配的Return ID列表
     * @returns {Array} Return ID数组
     */
    getMatchedReturnIds() {
        return this.cache.matchedResults.map(item => item.return_id);
    },

    /**
     * 获取匹配的完整结果
     * @returns {Array}
     */
    getMatchedResults() {
        return this.cache.matchedResults;
    },

    /**
     * 获取未匹配的SN列表
     * @returns {Array}
     */
    getUnmatchedSns() {
        return this.cache.unmatchedSns;
    },

    /**
     * 根据Return SN获取Return ID
     * @param {string} returnSn - Return SN
     * @returns {string|null} Return ID
     */
    getReturnId(returnSn) {
        return this.cache.snToIdMap.get(returnSn) || null;
    },

    /**
     * 清空缓存
     */
    clearCache() {
        this.cache.userInput = [];
        this.cache.matchedResults = [];
        this.cache.unmatchedSns = [];
        this.cache.snToIdMap.clear();
        ShopeeUtils.addLogToUI('匹配缓存已清空', 'info');
    },

    /**
     * 获取缓存信息
     * @returns {Object}
     */
    getCacheInfo() {
        return {
            userInputCount: this.cache.userInput.length,
            matchedCount: this.cache.matchedResults.length,
            unmatchedCount: this.cache.unmatchedSns.length,
            matchRate: this.cache.userInput.length > 0 
                ? (this.cache.matchedResults.length / this.cache.userInput.length * 100).toFixed(1) + '%'
                : '0%'
        };
    }
};

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SNMatcher;
}


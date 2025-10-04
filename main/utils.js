// ==UserScript==
// @name         Shopee工具-工具函数模块
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  共享工具函数
// @author       You
// ==/UserScript==

/**
 * 工具函数模块
 * 提供通用的工具函数供其他模块使用
 */
const ShopeeUtils = {
    /**
     * 日志输出
     * @param {string} message - 日志信息
     * @param {string} type - 日志类型 (info|success|error|warning)
     */
    log(message, type = 'info') {
        const colors = {
            info: '#569cd6',
            success: '#4ec9b0',
            error: '#f44747',
            warning: '#ffcc02'
        };
        const timestamp = new Date().toLocaleTimeString();
        console.log(`%c[${timestamp}] ${message}`, `color: ${colors[type]}`);
    },

    /**
     * 添加日志到UI
     * @param {string} message - 日志信息
     * @param {string} type - 日志类型
     */
    addLogToUI(message, type = 'info') {
        const container = document.getElementById('log-container');
        if (!container) return;

        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        entry.style.cssText = 'margin: 3px 0; font-size: 12px;';
        
        const timestamp = new Date().toLocaleTimeString();
        entry.textContent = `[${timestamp}] ${message}`;
        
        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;
    },

    /**
     * 延迟函数
     * @param {number} ms - 延迟毫秒数
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * 验证 Return SN 格式
     * @param {string} sn - Return SN
     * @returns {boolean}
     */
    validateReturnSn(sn) {
        return /^[A-Z0-9]{3,20}$/.test(sn);
    },

    /**
     * 获取日期范围（默认最近30天）
     * @returns {Object} {lower_value, upper_value}
     */
    getDefaultDateRange() {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);

        return {
            lower_value: Math.floor(start.getTime() / 1000),
            upper_value: Math.floor(end.getTime() / 1000)
        };
    },

    /**
     * 格式化时间戳为可读字符串
     * @param {number} timestamp - Unix时间戳（秒）
     * @returns {string}
     */
    formatTime(timestamp) {
        return new Date(timestamp * 1000).toLocaleString('zh-CN');
    },

    /**
     * 安全的JSON解析
     * @param {string} jsonStr - JSON字符串
     * @returns {Object|null}
     */
    safeJsonParse(jsonStr) {
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            this.log(`JSON解析失败: ${e.message}`, 'error');
            return null;
        }
    },

    /**
     * 生成CSV内容
     * @param {Array} data - 数据数组
     * @returns {string}
     */
    generateCSV(data) {
        if (!data || data.length === 0) return '';

        const BOM = '\uFEFF'; // UTF-8 BOM
        const headers = Object.keys(data[0]);
        const csvRows = [];

        // 添加表头
        csvRows.push(headers.map(h => `"${h}"`).join(','));

        // 添加数据行
        data.forEach(row => {
            const values = headers.map(header => {
                const value = row[header];
                if (value === null || value === undefined) return '""';
                if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
                return `"${String(value).replace(/"/g, '""')}"`;
            });
            csvRows.push(values.join(','));
        });

        return BOM + csvRows.join('\n');
    },

    /**
     * 下载CSV文件
     * @param {string} csvContent - CSV内容
     * @param {string} filename - 文件名
     */
    downloadCSV(csvContent, filename) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || `shopee_export_${Date.now()}.csv`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    },

    /**
     * 获取CSRF Token
     * @returns {string|null}
     */
    getCsrfToken() {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'csrftoken' || name === '_token') {
                return value;
            }
        }

        // 尝试从meta标签获取
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfMeta) {
            return csrfMeta.getAttribute('content');
        }

        return null;
    },

    /**
     * 显示错误提示
     * @param {string} message - 错误信息
     */
    showError(message) {
        this.log(message, 'error');
        this.addLogToUI(message, 'error');
        alert(`❌ 错误：${message}`);
    },

    /**
     * 显示成功提示
     * @param {string} message - 成功信息
     */
    showSuccess(message) {
        this.log(message, 'success');
        this.addLogToUI(message, 'success');
    }
};

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ShopeeUtils;
}


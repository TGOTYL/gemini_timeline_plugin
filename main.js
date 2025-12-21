// ==UserScript==
// @name         Gemini 智能导航 - 11.0 完美终极版
// @namespace    http://tampermonkey.net/
// @version      11.0
// @description  优化跳转位置至顶部，移除悬停闪烁动画，极致稳定体验
// @author       Gemini Thought Partner
// @match        https://gemini.google.com/app/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      open.bigmodel.cn
// ==/UserScript==

(function() {
    'use strict';

    let API_TOKEN = GM_getValue('zhipu_api_token', '');
    const MAX_CONCURRENT = 5;
    let activeRequests = 0;
    const requestQueue = [];

    let chatPairs = [];
    let lastUrl = location.href;

    GM_registerMenuCommand("设置智谱 AI Token", () => {
        const token = prompt("请输入智谱 AI API Key:", API_TOKEN);
        if (token) { GM_setValue('zhipu_api_token', token); location.reload(); }
    });

    const STYLES = `
        #gemini-nav-sidebar {
            position: fixed; right: 12px; top: 50%; transform: translateY(-50%);
            display: flex; flex-direction: column; gap: 6px;
            max-height: 80vh; padding: 12px; background: rgba(30, 31, 32, 0.75);
            backdrop-filter: blur(25px); border-radius: 12px; z-index: 9999;
            border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 12px 40px rgba(0,0,0,0.5);
            overflow-y: auto; scrollbar-width: none;
        }
        #gemini-nav-sidebar::-webkit-scrollbar { display: none; }
        .nav-row { display: flex; align-items: center; gap: 6px; height: 18px; }
        .nav-item { border-radius: 3px; cursor: pointer; transition: background 0.2s, opacity 0.2s, filter 0.2s; }
        .nav-item.user { height: 14px; width: 22px; background-color: #4285f4; }
        .nav-item.model { height: 10px; width: 10px; background-color: #9aa0a6; opacity: 0.5; }
        .nav-item.not-in-dom { opacity: 0.2; outline: 1px dashed rgba(255,255,255,0.4); }

        /* 移除 Scale 缩放，改用单纯的亮度提升，防止闪烁 */
        .nav-item:hover { filter: brightness(1.6); opacity: 1; }

        #gemini-nav-tooltip {
            position: fixed; right: 75px; padding: 14px; background: #202124;
            color: #f1f3f4; border-radius: 10px; font-size: 13px; width: 300px;
            display: none; z-index: 10000; border: 1px solid #3c4043;
            pointer-events: none; line-height: 1.6; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.innerText = STYLES;
    document.head.appendChild(styleSheet);

    const sidebar = document.createElement('div');
    sidebar.id = 'gemini-nav-sidebar';
    document.body.appendChild(sidebar);

    const tooltip = document.createElement('div');
    tooltip.id = 'gemini-nav-tooltip';
    document.body.appendChild(tooltip);

    function getHash(text) {
        if (!text) return "";
        return btoa(unescape(encodeURIComponent(text.trim().substring(0, 60)))).substring(0, 24);
    }

    // --- 逻辑更新 ---
    function updateNav() {
        if (location.href !== lastUrl) {
            chatPairs = [];
            lastUrl = location.href;
            sidebar.innerHTML = '';
        }

        const userQueries = Array.from(document.querySelectorAll('user-query'));
        if (userQueries.length === 0) return;

        userQueries.forEach((uq, index) => {
            const text = uq.innerText.trim();
            if (text.length < 1) return;
            const currentHash = getHash(text);

            let hasModel = false;
            let current = uq;
            for(let i=0; i<5; i++) {
                if (current && current.nextElementSibling && (current.nextElementSibling.querySelector('model-response') || current.nextElementSibling.tagName === 'MODEL-RESPONSE')) {
                    hasModel = true; break;
                }
                current = current.parentElement;
            }

            if (chatPairs[index]) {
                if (chatPairs[index].id !== currentHash) {
                    chatPairs[index].id = currentHash;
                    chatPairs[index].text = text;
                    chatPairs[index].summary = null;
                }
                chatPairs[index].hasModel = hasModel;
            } else {
                chatPairs.push({ id: currentHash, text: text, summary: null, hasModel: hasModel });
            }
        });

        if (chatPairs.length > userQueries.length) {
            chatPairs = chatPairs.slice(0, userQueries.length);
        }

        renderSidebar();
    }

    // --- 摘要 AI ---
    async function fetchSummary(text) {
        if (!API_TOKEN) return text.substring(0, 20);
        return new Promise((resolve) => {
            const task = () => {
                activeRequests++;
                GM_xmlhttpRequest({
                    method: "POST",
                    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_TOKEN}` },
                    data: JSON.stringify({
                        model: "GLM-4-Flash",
                        messages: [
                            {
                                role: "system",
                                content: "你是一个对话索引助手。请总结提问。要求：1.长度在50字之间；2.提取核心实体、主题或独特名词，保证总结的精炼巧妙；3.禁止回答问题；4.直接输出结果。"
                            },
                            { role: "user", content: `请总结：${text}` }
                        ],
                        stream: false
                    }),
                    onload: (res) => {
                        activeRequests--;
                        try {
                            const data = JSON.parse(res.responseText);
                            resolve(data.choices[0].message.content.trim().replace(/[#*]/g, '').substring(0, 35));
                        } catch (e) { resolve(text.substring(0, 20)); }
                        processQueue();
                    },
                    onerror: () => { activeRequests--; resolve(text.substring(0, 20)); processQueue(); }
                });
            };
            requestQueue.push(task);
            processQueue();
        });
    }

    function processQueue() {
        while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT) {
            requestQueue.shift()();
        }
    }

    // --- 改进的跳转逻辑：对齐顶部 ---
    async function smartJump(targetHash) {
        const findTarget = () => Array.from(document.querySelectorAll('user-query'))
                                     .find(el => getHash(el.innerText) === targetHash);
        let target = findTarget();

        const performScroll = (el) => {
            // 对齐到 start (顶部)
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        if (target) {
            performScroll(target);
            return;
        }

        // 回溯加载历史
        const scroller = document.querySelector('.ms-infinite-scroller') || window;
        let attempts = 0;
        const timer = setInterval(() => {
            if (scroller === window) window.scrollBy(0, -1200);
            else scroller.scrollTop -= 1200;
            target = findTarget();
            attempts++;
            if (target || attempts > 20 || (scroller !== window && scroller.scrollTop === 0)) {
                clearInterval(timer);
                if (target) performScroll(target);
            }
        }, 400);
    }

    // --- 渲染 (静默 hover 逻辑) ---
    function renderSidebar() {
        sidebar.innerHTML = '';
        const currentDomHashes = Array.from(document.querySelectorAll('user-query')).map(el => getHash(el.innerText));

        chatPairs.forEach((pair) => {
            const row = document.createElement('div');
            row.className = 'nav-row';
            const isVisible = currentDomHashes.includes(pair.id);

            // 用户块
            const uItem = document.createElement('div');
            uItem.className = `nav-item user ${!isVisible ? 'not-in-dom' : ''}`;
            uItem.onclick = () => smartJump(pair.id);
            uItem.onmouseenter = async (e) => {
                tooltip.style.display = 'block';
                tooltip.style.top = `${Math.min(window.innerHeight - 100, Math.max(10, e.clientY - 40))}px`;
                if (!pair.summary) {
                    tooltip.innerHTML = `<b style="color:#4285f4">提问摘要:</b><br><span style="color:#888">分析中...</span>`;
                    pair.summary = await fetchSummary(pair.text);
                }
                tooltip.innerHTML = `<b style="color:#4285f4">提问摘要:</b><br>${pair.summary}`;
            };
            uItem.onmouseleave = () => { tooltip.style.display = 'none'; tooltip.innerHTML = ''; };
            row.appendChild(uItem);

            // 答案块
            if (pair.hasModel) {
                const mItem = document.createElement('div');
                mItem.className = `nav-item model ${!isVisible ? 'not-in-dom' : ''}`;
                mItem.onclick = () => smartJump(pair.id);
                mItem.onmouseenter = (e) => {
                    tooltip.style.display = 'block';
                    tooltip.style.top = `${Math.min(window.innerHeight - 100, Math.max(10, e.clientY - 40))}px`;
                    tooltip.innerHTML = `<b style="color:#9aa0a6">Gemini 回答</b><br>点击跳转至顶部`;
                };
                mItem.onmouseleave = () => { tooltip.style.display = 'none'; tooltip.innerHTML = ''; };
                row.appendChild(mItem);
            }
            sidebar.appendChild(row);
        });
    }

    // --- 监听 ---
    setInterval(() => {
        if (location.href !== lastUrl) updateNav();
    }, 1500);

    const observer = new MutationObserver(() => {
        clearTimeout(window.navTimer);
        window.navTimer = setTimeout(updateNav, 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    setTimeout(updateNav, 2000);
})();

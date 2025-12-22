// ==UserScript==
// @name        Gemini 智能导航 - 12.1 稳定摘要版
// @namespace    http://tampermonkey.net/
// @version      12.1
// @description  优化跳转位置至顶部，移除悬停闪烁动画，极致稳定体验，自动后台总结，精准定位回答，低温度控制
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

        let structureChanged = false;

        if (chatPairs.length !== userQueries.length) {
            structureChanged = true;
        }

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
                    chatPairs[index].isLoading = false;
                    structureChanged = true;
                }
                if (chatPairs[index].hasModel !== hasModel) {
                    chatPairs[index].hasModel = hasModel;
                    structureChanged = true;
                }
            } else {
                chatPairs.push({ id: currentHash, text: text, summary: null, hasModel: hasModel, isLoading: false });
                structureChanged = true;
            }

            const pair = chatPairs[index];
            if (!pair.summary && !pair.isLoading && pair.text) {
                pair.isLoading = true;
                fetchSummary(pair);
            }
        });

        if (chatPairs.length > userQueries.length) {
            chatPairs = chatPairs.slice(0, userQueries.length);
            structureChanged = true;
        }

        if (structureChanged) {
            renderSidebar();
        }
    }

    // --- 摘要 AI ---
    async function fetchSummary(pair) {
        const text = pair.text;
        if (!API_TOKEN) {
            pair.summary = text.substring(0, 20);
            pair.isLoading = false;
            return;
        }

        const updatePair = (result) => {
            pair.summary = result;
            pair.isLoading = false;
            if (tooltip.style.display === 'block' && tooltip.getAttribute('data-active-id') === pair.id) {
                tooltip.innerHTML = `<b style="color:#4285f4">提问摘要:</b><br>${result}`;
            }
        };

        const task = () => {
            activeRequests++;
            GM_xmlhttpRequest({
                method: "POST",
                url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_TOKEN}` },
                data: JSON.stringify({
                    model: "GLM-4-Flash",
                    // 🔥 核心修改：加入温度控制，强制结果一致性
                    temperature: 0.1,
                    top_p: 0.1,
                    messages: [
                        {
                            role: "system",
                            content: "你是一个侧边栏导航命名专家。请将用户的输入提取为极其精炼的标题。要求：1. **必须严格控制在 12 个字以内**。2. 去掉“请问”、“怎么”、“如何”等无意义修饰词。3. 格式示例：“Python 去除空格的写法”、“InputERROR 报错修复”。4. 直接输出结果。"
                        },
                        { role: "user", content: `请总结：${text}` }
                    ],
                    stream: false
                }),
                onload: (res) => {
                    activeRequests--;
                    try {
                        const data = JSON.parse(res.responseText);
                        const summary = data.choices[0].message.content.trim().replace(/[#*]/g, '').substring(0, 35);
                        updatePair(summary);
                    } catch (e) { updatePair(text.substring(0, 20)); }
                    processQueue();
                },
                onerror: () => { activeRequests--; updatePair(text.substring(0, 20)); processQueue(); }
            });
        };
        requestQueue.push(task);
        processQueue();
    }

    function processQueue() {
        while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT) {
            requestQueue.shift()();
        }
    }

    // --- 改进的跳转逻辑：支持跳转到回答 (isModel 参数) ---
    async function smartJump(targetHash, isModel = false) {
        // 查找目标函数
        const findTarget = () => {
            // 1. 先找到 user-query
            const uq = Array.from(document.querySelectorAll('user-query'))
                             .find(el => getHash(el.innerText) === targetHash);

            if (!uq) return null;
            if (!isModel) return uq; // 如果只要找提问，直接返回

            // 2. 如果要找回答，基于 uq 向下寻找 model-response
            let current = uq;
            for(let i=0; i<5; i++) {
                if (current && current.nextElementSibling) {
                    const sibling = current.nextElementSibling;
                    // 兼容不同版本的 DOM 结构
                    if (sibling.tagName === 'MODEL-RESPONSE' || sibling.querySelector('model-response')) {
                        return sibling;
                    }
                }
                current = current.parentElement;
            }
            // 如果没找到回答（可能还没生成），则回退到跳转提问
            return uq;
        };

        let target = findTarget();

        const performScroll = (el) => {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        if (target) {
            performScroll(target);
            return;
        }

        const scroller = document.querySelector('.ms-infinite-scroller') || window;
        let attempts = 0;
        const timer = setInterval(() => {
            if (scroller === window) window.scrollBy(0, -1200);
            else scroller.scrollTop -= 1200;

            target = findTarget(); // 重新查找
            attempts++;

            if (target || attempts > 20 || (scroller !== window && scroller.scrollTop === 0)) {
                clearInterval(timer);
                if (target) performScroll(target);
            }
        }, 400);
    }

    // --- 渲染 ---
    function renderSidebar() {
        sidebar.innerHTML = '';
        const currentDomHashes = Array.from(document.querySelectorAll('user-query')).map(el => getHash(el.innerText));

        chatPairs.forEach((pair) => {
            const row = document.createElement('div');
            row.className = 'nav-row';
            const isVisible = currentDomHashes.includes(pair.id);

            // 用户块 (false: 跳提问)
            const uItem = document.createElement('div');
            uItem.className = `nav-item user ${!isVisible ? 'not-in-dom' : ''}`;
            uItem.onclick = () => smartJump(pair.id, false);
            uItem.onmouseenter = (e) => {
                tooltip.style.display = 'block';
                tooltip.setAttribute('data-active-id', pair.id);
                tooltip.style.top = `${Math.min(window.innerHeight - 100, Math.max(10, e.clientY - 40))}px`;

                if (pair.summary) {
                    tooltip.innerHTML = `<b style="color:#4285f4">提问摘要:</b><br>${pair.summary}`;
                } else if (pair.isLoading) {
                    tooltip.innerHTML = `<b style="color:#4285f4">提问摘要:</b><br><span style="color:#888">AI 正在分析中...</span>`;
                } else {
                    tooltip.innerHTML = `<b style="color:#4285f4">提问摘要:</b><br><span style="color:#888">等待分析...</span>`;
                }
            };
            uItem.onmouseleave = () => {
                tooltip.style.display = 'none';
                tooltip.innerHTML = '';
                tooltip.removeAttribute('data-active-id');
            };
            row.appendChild(uItem);

            // 答案块 (true: 跳回答)
            if (pair.hasModel) {
                const mItem = document.createElement('div');
                mItem.className = `nav-item model ${!isVisible ? 'not-in-dom' : ''}`;
                mItem.onclick = () => smartJump(pair.id, true);
                mItem.onmouseenter = (e) => {
                    tooltip.style.display = 'block';
                    tooltip.style.top = `${Math.min(window.innerHeight - 100, Math.max(10, e.clientY - 40))}px`;
                    tooltip.innerHTML = `<b style="color:#9aa0a6">Gemini 回答</b><br>点击跳转至回答顶部`;
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

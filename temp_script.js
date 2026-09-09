
        // ═══════════════════════════════════════════════════════════════
        // UTILITIES
        // ═══════════════════════════════════════════════════════════════

        const API = '';
        let loadedStrategies = [];

        // ═══════════════════════════════════════════════════════════════
        // PERSISTENT COLLAPSIBLE MANAGER (WINDOWS & SECTIONS)
        // ═══════════════════════════════════════════════════════════════
        function getWindowCollapseState(contentId, defaultCollapsed = false) {
            try {
                const saved = JSON.parse(localStorage.getItem('tbs_window_collapse_state') || '{}');
                if (saved.hasOwnProperty(contentId)) {
                    return Boolean(saved[contentId]);
                }
            } catch (e) { }
            return defaultCollapsed;
        }

        function setWindowCollapseState(contentId, isCollapsed) {
            try {
                const saved = JSON.parse(localStorage.getItem('tbs_window_collapse_state') || '{}');
                saved[contentId] = Boolean(isCollapsed);
                localStorage.setItem('tbs_window_collapse_state', JSON.stringify(saved));
            } catch (e) { }
        }

        function toggleCardCollapse(contentId, chevronId, forceExpand = false) {
            const content = document.getElementById(contentId);
            const chevron = chevronId ? document.getElementById(chevronId) : null;
            if (!content) return;

            const isCurrentlyHidden = content.style.display === 'none' || getComputedStyle(content).display === 'none';
            const willExpand = forceExpand || isCurrentlyHidden;

            content.style.display = willExpand ? 'block' : 'none';
            if (chevron) {
                if (willExpand) chevron.classList.remove('collapsed');
                else chevron.classList.add('collapsed');
            }

            // Persist the state: true = collapsed, false = expanded
            setWindowCollapseState(contentId, !willExpand);
        }

        function initWindowCollapseStates() {
            const collapsibleWindows = [
                { contentId: 'strategyFormCollapseContent', chevronId: 'strategyFormChevron', defaultCollapsed: true },
                { contentId: 'posStrategyFormCollapseContent', chevronId: 'posStrategyFormChevron', defaultCollapsed: true },
                { contentId: 'straddleFormCollapseContent', chevronId: 'straddleFormChevron', defaultCollapsed: true },
                { contentId: 'commodityFormCollapseContent', chevronId: 'commodityFormChevron', defaultCollapsed: true },
                { contentId: 'tvRuleFormCollapseContent', chevronId: 'tvRuleFormChevron', defaultCollapsed: true },
                { contentId: 'intraHistoryContainer', chevronId: null, defaultCollapsed: true },
                { contentId: 'commHistoryContainer', chevronId: null, defaultCollapsed: true }
            ];

            collapsibleWindows.forEach(win => {
                const content = document.getElementById(win.contentId);
                const chevron = win.chevronId ? document.getElementById(win.chevronId) : null;
                if (!content) return;

                const isCollapsed = getWindowCollapseState(win.contentId, win.defaultCollapsed);
                content.style.display = isCollapsed ? 'none' : 'block';
                if (chevron) {
                    if (isCollapsed) chevron.classList.add('collapsed');
                    else chevron.classList.remove('collapsed');
                }
            });
        }

        // Run early so UI starts in preferred state
        try {
            initWindowCollapseStates();
        } catch (e) { }

        // ═══════════════════════════════════════════════════════════════
        // INDIVIDUAL STRATEGY CARD COLLAPSIBLE MANAGER (ALL TABS)
        // ═══════════════════════════════════════════════════════════════
        function loadStratCardCollapseState() {
            try {
                return JSON.parse(localStorage.getItem('tbs_strat_card_collapse_state') || '{}');
            } catch (e) {
                return {};
            }
        }

        const stratCardCollapseState = loadStratCardCollapseState();

        function isStrategyCardCollapsed(stratId) {
            // Check persisted state; default to collapsed (true) so cards display in clean compact summary mode
            if (stratCardCollapseState.hasOwnProperty(stratId)) {
                return Boolean(stratCardCollapseState[stratId]);
            }
            return true;
        }

        function toggleStrategyCard(stratId, forceExpand = false) {
            const currentlyCollapsed = isStrategyCardCollapsed(stratId);
            const newState = forceExpand ? false : !currentlyCollapsed;
            stratCardCollapseState[stratId] = newState;

            try {
                localStorage.setItem('tbs_strat_card_collapse_state', JSON.stringify(stratCardCollapseState));
            } catch (e) { }

            const body = document.getElementById(`stratCardBody_${stratId}`);
            const chevron = document.getElementById(`stratCardChevron_${stratId}`);
            if (body) body.style.display = newState ? 'none' : 'block';
            if (chevron) {
                if (newState) chevron.classList.add('collapsed');
                else chevron.classList.remove('collapsed');
            }
        }

        function toggleAllStrategiesInGroup(groupId) {
            const cards = document.querySelectorAll(`[data-group-id="${groupId}"]`);
            if (!cards || cards.length === 0) return;

            let anyCollapsed = false;
            cards.forEach(c => {
                const id = c.dataset.stratId;
                if (isStrategyCardCollapsed(id)) anyCollapsed = true;
            });

            const targetCollapsed = !anyCollapsed; // If any is collapsed, expand all (false); else collapse all (true)
            cards.forEach(c => {
                const id = c.dataset.stratId;
                stratCardCollapseState[id] = targetCollapsed;
                const body = document.getElementById(`stratCardBody_${id}`);
                const chevron = document.getElementById(`stratCardChevron_${id}`);
                if (body) body.style.display = targetCollapsed ? 'none' : 'block';
                if (chevron) {
                    if (targetCollapsed) chevron.classList.add('collapsed');
                    else chevron.classList.remove('collapsed');
                }
            });

            try {
                localStorage.setItem('tbs_strat_card_collapse_state', JSON.stringify(stratCardCollapseState));
            } catch (e) { }
        }

        function formatStrategyDelta(s) {
            let delta = null;
            if (s.greeks && s.greeks.net_delta_unit !== undefined) {
                delta = parseFloat(s.greeks.net_delta_unit);
            } else if (s.delta !== undefined && s.delta !== null) {
                delta = parseFloat(s.delta);
            } else if (s.orders) {
                let dSum = 0;
                let hasG = false;
                if (s.orders.CE && s.orders.CE.greeks && s.orders.CE.greeks.pos_delta !== undefined) {
                    dSum += parseFloat(s.orders.CE.greeks.pos_delta);
                    hasG = true;
                }
                if (s.orders.PE && s.orders.PE.greeks && s.orders.PE.greeks.pos_delta !== undefined) {
                    dSum += parseFloat(s.orders.PE.greeks.pos_delta);
                    hasG = true;
                }
                if (hasG) delta = dSum;
            }

            if (delta !== null && !isNaN(delta)) {
                const sign = delta >= 0 ? '+' : '';
                const bg = delta >= 0 ? '#dcfce7' : '#fee2e2';
                const color = delta >= 0 ? '#15803d' : '#b91c1c';
                const border = delta >= 0 ? '#bbf7d0' : '#fecaca';
                return `<span style="background: ${bg}; color: ${color}; border: 1px solid ${border}; font-size: 11px; font-weight: 800; padding: 2px 7px; border-radius: 6px; font-family: monospace;" title="Strategy Net Delta (Δ)">Δ ${sign}${delta.toFixed(2)}</span>`;
            }
            return `<span style="background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 6px; font-family: monospace;" title="Delta calculated when orders are active">Δ --</span>`;
        }

        function formatStrategyExpiry(s) {
            if (s.resolved_expiry) return s.resolved_expiry;
            if (s.expiry) {
                if (s.expiry === 'CURRENT' || s.expiry === 'CURRENT_MONTH') return 'Current Expiry';
                if (s.expiry === 'NEXT' || s.expiry === 'NEXT_MONTH') return 'Next Expiry';
                return s.expiry;
            }
            return '--';
        }

        function getStrategyPnl(s) {
            let computed = 0;
            let found = false;
            const symbolsToCheck = new Set();
            if (s.selected_ce) symbolsToCheck.add(s.selected_ce);
            if (s.selected_pe) symbolsToCheck.add(s.selected_pe);
            if (s.orders) {
                if (s.orders.CE && s.orders.CE.symbol) symbolsToCheck.add(s.orders.CE.symbol);
                if (s.orders.PE && s.orders.PE.symbol) symbolsToCheck.add(s.orders.PE.symbol);
            }
            if (s.adjustments && s.adjustments.active_orders) {
                Object.values(s.adjustments.active_orders).forEach(a => {
                    if (a.symbol) symbolsToCheck.add(a.symbol);
                });
            }

            if (window.latestNetPositions && Array.isArray(window.latestNetPositions) && symbolsToCheck.size > 0) {
                window.latestNetPositions.forEach(p => {
                    if (symbolsToCheck.has(p.tradingsymbol)) {
                        computed += parseFloat(p.pnl || p.m2m || 0);
                        found = true;
                    }
                });
            }
            if (found) return computed;
            if (s.pnl !== undefined && s.pnl !== null && parseFloat(s.pnl) !== 0) {
                return parseFloat(s.pnl);
            }
            return parseFloat(s.pnl || 0);
        }

        // ═══════════════════════════════════════════════════════════════
        // INLINE STRATEGY CARD EDITING SYSTEM (All Tabs)
        // ═══════════════════════════════════════════════════════════════
        const inlineEditingStratIds = new Set();
        const stratCardMode = {}; // stratId -> 'VIEW' | 'EDIT'

        function getStratInnerMode(stratId) {
            return stratCardMode[stratId] || 'VIEW';
        }

        function switchStratInnerMode(stratId, mode) {
            stratCardMode[stratId] = mode;
            if (mode === 'EDIT') {
                inlineEditingStratIds.add(stratId);
            } else {
                inlineEditingStratIds.delete(stratId);
            }

            const viewPanel = document.getElementById(`stratViewPanel_${stratId}`);
            const editPanel = document.getElementById(`stratEditPanel_${stratId}`);
            const btnView = document.getElementById(`btnModeView_${stratId}`);
            const btnEdit = document.getElementById(`btnModeEdit_${stratId}`);

            if (viewPanel) viewPanel.style.display = (mode === 'VIEW' ? 'block' : 'none');
            if (editPanel) editPanel.style.display = (mode === 'EDIT' ? 'block' : 'none');

            if (btnView) {
                if (mode === 'VIEW') {
                    btnView.style.background = 'var(--pastel-blue-bg)';
                    btnView.style.color = 'var(--pastel-blue-dark)';
                    btnView.style.borderColor = 'var(--pastel-blue-border)';
                    btnView.style.fontWeight = '800';
                } else {
                    btnView.style.background = '#ffffff';
                    btnView.style.color = 'var(--text-secondary)';
                    btnView.style.borderColor = 'var(--border-color)';
                    btnView.style.fontWeight = '600';
                }
            }

            if (btnEdit) {
                if (mode === 'EDIT') {
                    btnEdit.style.background = 'var(--pastel-blue-bg)';
                    btnEdit.style.color = 'var(--pastel-blue-dark)';
                    btnEdit.style.borderColor = 'var(--pastel-blue-border)';
                    btnEdit.style.fontWeight = '800';
                } else {
                    btnEdit.style.background = '#ffffff';
                    btnEdit.style.color = 'var(--text-secondary)';
                    btnEdit.style.borderColor = 'var(--border-color)';
                    btnEdit.style.fontWeight = '600';
                }
            }
        }

        function toggleStrategyInlineEdit(stratType, stratId) {
            toggleStrategyCard(stratId, true); // ensure card is expanded
            const currentMode = getStratInnerMode(stratId);
            const newMode = (currentMode === 'EDIT') ? 'VIEW' : 'EDIT';
            switchStratInnerMode(stratId, newMode);

            if (newMode === 'EDIT') {
                const cardEl = document.querySelector(`[data-strat-id="${stratId}"]`);
                if (cardEl) {
                    setTimeout(() => {
                        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 50);
                }
            }
        }

        const cachedExpiriesByIndex = {};
        async function fetchExpiriesForIndex(idx) {
            if (cachedExpiriesByIndex[idx]) return cachedExpiriesByIndex[idx];
            try {
                const res = await api(`/api/expiries?index=${idx}`);
                const dates = Array.isArray(res) ? res : (res?.dates || []);
                cachedExpiriesByIndex[idx] = dates;
                return dates;
            } catch (e) {
                return [];
            }
        }

        function buildExpirySelectOptions(indexName, currentVal) {
            const dates = cachedExpiriesByIndex[indexName] || [];
            let html = '';
            html += `<option value="CURRENT" ${(!currentVal || currentVal === 'CURRENT') ? 'selected' : ''}>⚡ Current Expiry</option>`;
            html += `<option value="NEXT" ${currentVal === 'NEXT' ? 'selected' : ''}>📅 Next Expiry</option>`;
            if (dates.length > 0) {
                html += `<optgroup label="All Expiry Dates">`;
                dates.forEach(d => {
                    html += `<option value="${d}" ${currentVal === d ? 'selected' : ''}>${d}</option>`;
                });
                html += `</optgroup>`;
            } else if (currentVal && currentVal !== 'CURRENT' && currentVal !== 'NEXT') {
                html += `<option value="${currentVal}" selected>${currentVal}</option>`;
            }
            return html;
        }

        async function onInlineIntraIndexChange(stratId) {
            const idxEl = document.getElementById(`inline_intra_index_${stratId}`);
            const expEl = document.getElementById(`inline_intra_expiry_${stratId}`);
            if (!idxEl || !expEl) return;
            const dates = await fetchExpiriesForIndex(idxEl.value);
            expEl.innerHTML = buildExpirySelectOptions(idxEl.value, expEl.value);
        }

        async function onInlinePosIndexChange(stratId) {
            const idxEl = document.getElementById(`inline_pos_index_${stratId}`);
            const expEl = document.getElementById(`inline_pos_expiry_${stratId}`);
            const qtyEl = document.getElementById(`inline_pos_qty_${stratId}`);
            if (!idxEl) return;
            if (qtyEl) {
                const lot = getBrokerLotSize(idxEl.value);
                qtyEl.value = lot;
            }
            if (expEl) {
                const dates = await fetchExpiriesForIndex(idxEl.value);
                expEl.innerHTML = buildExpirySelectOptions(idxEl.value, expEl.value);
            }
        }

        async function onInlineStraddleIndexChange(stratId) {
            const idxEl = document.getElementById(`inline_straddle_index_${stratId}`);
            const expEl = document.getElementById(`inline_straddle_expiry_${stratId}`);
            const qtyEl = document.getElementById(`inline_straddle_qty_${stratId}`);
            if (!idxEl) return;
            if (qtyEl) {
                const lot = getBrokerLotSize(idxEl.value);
                qtyEl.value = lot;
            }
            if (expEl) {
                const dates = await fetchExpiriesForIndex(idxEl.value);
                expEl.innerHTML = buildExpirySelectOptions(idxEl.value, expEl.value);
            }
        }

        function onInlineStraddleTypeChange(stratId) {
            const typeEl = document.getElementById(`inline_straddle_type_${stratId}`);
            const legSelRow = document.getElementById(`inline_straddle_leg_sel_row_${stratId}`);
            if (!typeEl || !legSelRow) return;
            legSelRow.style.display = (typeEl.value === 'INDIVIDUAL_LEG') ? 'block' : 'none';
        }

        function onInlineStraddleStrikeModeChange(stratId) {
            const modeEl = document.getElementById(`inline_straddle_strike_mode_${stratId}`);
            const roundRow = document.getElementById(`inline_straddle_round_row_${stratId}`);
            const manualRow = document.getElementById(`inline_straddle_manual_row_${stratId}`);
            const premRow = document.getElementById(`inline_straddle_prem_row_${stratId}`);
            if (!modeEl) return;
            const mode = modeEl.value;
            if (roundRow) roundRow.style.display = (mode === 'ROUND_OFF') ? 'block' : 'none';
            if (manualRow) manualRow.style.display = (mode === 'MANUAL') ? 'block' : 'none';
            if (premRow) premRow.style.display = (mode === 'PREMIUM') ? 'block' : 'none';
        }

        async function saveInlineIntraStrategy(stratId) {
            const name = (document.getElementById(`inline_intra_name_${stratId}`)?.value || '').trim() || 'Strategy';
            const indexName = document.getElementById(`inline_intra_index_${stratId}`)?.value || 'NIFTY';
            const expiry = document.getElementById(`inline_intra_expiry_${stratId}`)?.value || 'CURRENT';
            const type = document.getElementById(`inline_intra_type_${stratId}`)?.value || 'STRANGLE';
            const action = document.getElementById(`inline_intra_action_${stratId}`)?.value || 'SELL';
            const product = document.getElementById(`inline_intra_product_${stratId}`)?.value || 'MIS';
            const cePrem = parseFloat(document.getElementById(`inline_intra_ce_prem_${stratId}`)?.value || 100);
            const pePrem = parseFloat(document.getElementById(`inline_intra_pe_prem_${stratId}`)?.value || 100);
            const slType = document.getElementById(`inline_intra_sl_type_${stratId}`)?.value || 'PERCENT';
            const slVal = parseFloat(document.getElementById(`inline_intra_sl_val_${stratId}`)?.value || 20);
            const enableTsl = document.getElementById(`inline_intra_enable_tsl_${stratId}`)?.checked || false;
            const tslPts = parseFloat(document.getElementById(`inline_intra_tsl_pts_${stratId}`)?.value || 10);
            const startTime = ensureHHMMSS(document.getElementById(`inline_intra_start_time_${stratId}`)?.value || '09:20:00');
            const endTime = ensureHHMMSS(document.getElementById(`inline_intra_end_time_${stratId}`)?.value || '15:15:00');
            const qty = parseInt(document.getElementById(`inline_intra_qty_${stratId}`)?.value || 65);
            const reentry = parseInt(document.getElementById(`inline_intra_reentry_${stratId}`)?.value || 0);

            const payload = {
                id: stratId,
                name: name,
                strategy_type: type,
                entry_action: action,
                index_name: indexName,
                expiry: expiry,
                ce_premium: cePrem,
                pe_premium: pePrem,
                sl_type: slType,
                sl_points: slType === 'POINTS' ? slVal : undefined,
                sl_percent: slType === 'PERCENT' ? slVal : undefined,
                product: product,
                enable_tsl: enableTsl,
                tsl_points: tslPts,
                start_time: startTime,
                end_time: endTime,
                quantity: qty,
                reentry_count: reentry
            };

            const res = await api('/api/strategies', 'POST', payload);
            if (res.status === 'ok') {
                toast(`Strategy '${name}' updated successfully`);
                inlineEditingStratIds.delete(stratId);
                stratCardMode[stratId] = 'VIEW';
                fetchAndRenderStrategies();
                refreshOrdersAndPositions();
            } else {
                toast(res.message || 'Error updating strategy', true);
            }
        }

        async function saveInlinePosStrategy(stratId) {
            const name = (document.getElementById(`inline_pos_name_${stratId}`)?.value || '').trim() || 'Positional Strangle';
            const indexName = document.getElementById(`inline_pos_index_${stratId}`)?.value || 'NIFTY';
            const expiry = document.getElementById(`inline_pos_expiry_${stratId}`)?.value || 'CURRENT';
            const action = document.getElementById(`inline_pos_action_${stratId}`)?.value || 'SELL';
            const product = document.getElementById(`inline_pos_product_${stratId}`)?.value || 'NRML';
            const cePrem = parseFloat(document.getElementById(`inline_pos_ce_prem_${stratId}`)?.value || 80);
            const pePrem = parseFloat(document.getElementById(`inline_pos_pe_prem_${stratId}`)?.value || 80);
            const ceSl = parseFloat(document.getElementById(`inline_pos_ce_sl_${stratId}`)?.value || 50);
            const peSl = parseFloat(document.getElementById(`inline_pos_pe_sl_${stratId}`)?.value || 50);
            const tpVal = parseFloat(document.getElementById(`inline_pos_tp_${stratId}`)?.value || 70);
            const enableTsl = document.getElementById(`inline_pos_enable_tsl_${stratId}`)?.checked || false;
            const tslPts = parseFloat(document.getElementById(`inline_pos_tsl_pts_${stratId}`)?.value || 10);
            const entryTime = ensureHHMMSS(document.getElementById(`inline_pos_entry_time_${stratId}`)?.value || '15:00:00');
            const morningSl = ensureHHMMSS(document.getElementById(`inline_pos_morning_sl_${stratId}`)?.value || '09:17:00');
            const exitTime = ensureHHMMSS(document.getElementById(`inline_pos_exit_time_${stratId}`)?.value || '15:15:00');
            const qty = parseInt(document.getElementById(`inline_pos_qty_${stratId}`)?.value || 65);
            const reentry = parseInt(document.getElementById(`inline_pos_reentry_${stratId}`)?.value || 1);

            const payload = {
                id: stratId,
                name: name,
                index_name: indexName,
                expiry: expiry,
                entry_action: action,
                product: product,
                ce_premium: cePrem,
                pe_premium: pePrem,
                ce_sl_percent: ceSl,
                pe_sl_percent: peSl,
                sl_percent: ceSl,
                tp_percent: tpVal,
                enable_tsl: enableTsl,
                tsl_points: tslPts,
                tsl_step: tslPts,
                tsl_value: tslPts,
                reentry_count: reentry,
                quantity: qty,
                entry_time: entryTime,
                morning_sl_time: morningSl,
                exit_time: exitTime,
                start_time: entryTime,
                end_time: exitTime
            };

            const res = await api('/api/pos_strangle/strategies', 'POST', payload);
            if (res.status === 'ok') {
                toast(`Strategy '${name}' updated successfully`);
                inlineEditingStratIds.delete(stratId);
                stratCardMode[stratId] = 'VIEW';
                fetchPosStrangleStatus();
            } else {
                toast(res.message || 'Error updating strategy', true);
            }
        }

        async function saveInlineStraddleStrategy(stratId) {
            const existing = (loadedStraddleStrategies || []).find(s => s.id === stratId) || {};
            const name = (document.getElementById(`inline_straddle_name_${stratId}`)?.value || '').trim() || 'Straddle Total SL';
            const groupName = (document.getElementById(`inline_straddle_group_${stratId}`)?.value || '').trim() || 'Main Group';
            const stratType = document.getElementById(`inline_straddle_type_${stratId}`)?.value || 'STRADDLE';
            const legSel = document.getElementById(`inline_straddle_leg_sel_${stratId}`)?.value || 'BOTH';
            const indexName = document.getElementById(`inline_straddle_index_${stratId}`)?.value || 'NIFTY';
            const undType = document.getElementById(`inline_straddle_und_type_${stratId}`)?.value || 'CASH';
            const expiry = document.getElementById(`inline_straddle_expiry_${stratId}`)?.value || 'CURRENT';
            const strikeMode = document.getElementById(`inline_straddle_strike_mode_${stratId}`)?.value || 'ATM';
            const strikeMult = parseFloat(document.getElementById(`inline_straddle_strike_mult_${stratId}`)?.value || 500);
            const manualStrike = parseFloat(document.getElementById(`inline_straddle_manual_strike_${stratId}`)?.value);
            const ceStrike = parseFloat(document.getElementById(`inline_straddle_ce_strike_${stratId}`)?.value);
            const peStrike = parseFloat(document.getElementById(`inline_straddle_pe_strike_${stratId}`)?.value);
            const ceTargetPrem = parseFloat(document.getElementById(`inline_straddle_ce_prem_${stratId}`)?.value || 80);
            const peTargetPrem = parseFloat(document.getElementById(`inline_straddle_pe_prem_${stratId}`)?.value || 80);
            const action = document.getElementById(`inline_straddle_action_${stratId}`)?.value || 'SELL';
            const product = document.getElementById(`inline_straddle_product_${stratId}`)?.value || 'NRML';
            const qty = parseInt(document.getElementById(`inline_straddle_qty_${stratId}`)?.value || 65);
            const entryTime = ensureHHMMSS(document.getElementById(`inline_straddle_entry_time_${stratId}`)?.value || '15:00:00');
            const exitDays = parseInt(document.getElementById(`inline_straddle_exit_days_${stratId}`)?.value || 0);
            const exitTime = ensureHHMMSS(document.getElementById(`inline_straddle_exit_time_${stratId}`)?.value || '15:15:00');
            const slMode = document.getElementById(`inline_straddle_sl_mode_${stratId}`)?.value || 'PERCENT';
            const slVal = parseFloat(document.getElementById(`inline_straddle_sl_val_${stratId}`)?.value || 100);
            const tpVal = parseFloat(document.getElementById(`inline_straddle_tp_val_${stratId}`)?.value || 50);
            const enableTsl = document.getElementById(`inline_straddle_enable_tsl_${stratId}`)?.checked || false;
            const tslStep = parseFloat(document.getElementById(`inline_straddle_tsl_step_${stratId}`)?.value || 10);
            const tslVal = parseFloat(document.getElementById(`inline_straddle_tsl_val_${stratId}`)?.value || 10);

            const payload = {
                id: stratId,
                name: name,
                group_name: groupName,
                strategy_type: stratType,
                leg_selection: stratType === 'INDIVIDUAL_LEG' ? legSel : 'BOTH',
                entry_trigger_type: existing.entry_trigger_type || 'CURRENT_PRICE',
                trigger_decay_pct: existing.trigger_decay_pct !== undefined ? existing.trigger_decay_pct : 20.0,
                trigger_premium_val: existing.trigger_premium_val !== undefined ? existing.trigger_premium_val : 0.0,
                index_name: indexName,
                underlying_type: undType,
                expiry: expiry,
                strike_mode: strikeMode,
                strike_multiple: strikeMult,
                manual_strike: !isNaN(manualStrike) && manualStrike > 0 ? manualStrike : undefined,
                ce_strike: !isNaN(ceStrike) && ceStrike > 0 ? ceStrike : undefined,
                pe_strike: !isNaN(peStrike) && peStrike > 0 ? peStrike : undefined,
                ce_target_premium: ceTargetPrem,
                pe_target_premium: peTargetPrem,
                strike: strikeMode === 'MANUAL' && !isNaN(manualStrike) ? String(manualStrike) : (strikeMode === 'ROUND_OFF' ? `ROUND_${strikeMult}` : 'ATM'),
                entry_action: action,
                product: product,
                sl_mode: slMode,
                sl_value: slVal,
                tp_mode: slMode,
                tp_value: tpVal,
                total_sl_percent: slVal,
                total_tp_percent: tpVal,
                enable_tsl: enableTsl,
                tsl_type: "POINTS",
                tsl_step: tslStep,
                tsl_value: tslVal,
                quantity: qty,
                entry_time: entryTime,
                exit_time: exitTime,
                exit_days_to_expiry: exitDays,
                adjustments: existing.adjustments || { enabled: false }
            };

            const res = await api('/api/straddle_total_sl/strategies', 'POST', payload);
            if (res.status === 'ok') {
                toast(`Strategy '${name}' updated successfully`);
                inlineEditingStratIds.delete(stratId);
                stratCardMode[stratId] = 'VIEW';
                fetchStraddleStatus();
            } else {
                toast(res.message || 'Error updating strategy', true);
            }
        }

        function buildIntraInlineEditPanel(s) {
            const slType = (s.sl_type || 'PERCENT').toUpperCase();
            const slVal = (slType === 'POINTS' ? s.sl_points : (s.sl_percent !== undefined ? s.sl_percent : 20)) || 20;
            const expOptions = buildExpirySelectOptions(s.index_name || 'NIFTY', s.expiry);

            return `
            <div id="stratEditPanel_${s.id}" style="display: ${getStratInnerMode(s.id) === 'EDIT' ? 'block' : 'none'}; background: #fdfbf7; border: 1px solid var(--pastel-blue-border); border-radius: var(--radius-sm); padding: 16px; margin-top: 6px;">
                <div style="font-size: 13px; font-weight: 800; color: var(--accent-light); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <span>✏️ Edit Strategy Configuration</span>
                    <span style="font-size: 10px; color: var(--text-muted); font-weight: 600;">Changes take effect immediately on save</span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Strategy Name</label>
                        <input type="text" id="inline_intra_name_${s.id}" value="${s.name || ''}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Underlying Index</label>
                        <select id="inline_intra_index_${s.id}" onchange="onInlineIntraIndexChange('${s.id}')" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="NIFTY" ${s.index_name === 'NIFTY' ? 'selected' : ''}>NIFTY 50</option>
                            <option value="BANKNIFTY" ${s.index_name === 'BANKNIFTY' ? 'selected' : ''}>BANKNIFTY</option>
                            <option value="FINNIFTY" ${s.index_name === 'FINNIFTY' ? 'selected' : ''}>FINNIFTY</option>
                            <option value="MIDCPNIFTY" ${s.index_name === 'MIDCPNIFTY' ? 'selected' : ''}>MIDCPNIFTY</option>
                            <option value="SENSEX" ${s.index_name === 'SENSEX' ? 'selected' : ''}>SENSEX</option>
                            <option value="BANKEX" ${s.index_name === 'BANKEX' ? 'selected' : ''}>BANKEX</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Expiry Contract</label>
                        <select id="inline_intra_expiry_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            ${expOptions}
                        </select>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Strategy Type</label>
                        <select id="inline_intra_type_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="STRANGLE" ${s.strategy_type === 'STRANGLE' ? 'selected' : ''}>Strangle</option>
                            <option value="STRADDLE" ${s.strategy_type === 'STRADDLE' ? 'selected' : ''}>Straddle</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Entry Action</label>
                        <select id="inline_intra_action_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="SELL" ${s.entry_action === 'SELL' ? 'selected' : ''}>🔴 Short / Sell</option>
                            <option value="BUY" ${s.entry_action === 'BUY' ? 'selected' : ''}>🟢 Long / Buy</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Product Type</label>
                        <select id="inline_intra_product_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="MIS" ${(s.product || 'MIS') === 'MIS' ? 'selected' : ''}>MIS (Intraday)</option>
                            <option value="NRML" ${s.product === 'NRML' ? 'selected' : ''}>NRML (Overnight)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Quantity</label>
                        <input type="number" id="inline_intra_qty_${s.id}" value="${s.quantity || 65}" min="1" step="1" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Call Target Prem (₹)</label>
                        <input type="number" id="inline_intra_ce_prem_${s.id}" value="${s.ce_premium || 100}" step="0.5" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Put Target Prem (₹)</label>
                        <input type="number" id="inline_intra_pe_prem_${s.id}" value="${s.pe_premium || 100}" step="0.5" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Stop Loss Type</label>
                        <select id="inline_intra_sl_type_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="PERCENT" ${slType === 'PERCENT' ? 'selected' : ''}>Percentage (%)</option>
                            <option value="POINTS" ${slType === 'POINTS' ? 'selected' : ''}>Points</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Stop Loss Value</label>
                        <input type="number" id="inline_intra_sl_val_${s.id}" value="${slVal}" step="0.5" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Start Time (HH:MM:SS)</label>
                        <input type="time" step="1" id="inline_intra_start_time_${s.id}" value="${s.start_time || '09:20:00'}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">End Time (HH:MM:SS)</label>
                        <input type="time" step="1" id="inline_intra_end_time_${s.id}" value="${s.end_time || '15:15:00'}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Max Re-entries</label>
                        <input type="number" id="inline_intra_reentry_${s.id}" value="${s.reentry_count || 0}" min="0" max="10" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                            <input type="checkbox" id="inline_intra_enable_tsl_${s.id}" ${s.enable_tsl ? 'checked' : ''} style="margin: 0;">
                            <span>Enable TSL (Pts)</span>
                        </label>
                        <input type="number" id="inline_intra_tsl_pts_${s.id}" value="${s.tsl_points || 10}" min="1" step="1" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                    <button type="button" class="btn-secondary" onclick="switchStratInnerMode('${s.id}', 'VIEW')" style="padding: 6px 14px; font-size: 12px; font-weight: 700;">❌ Cancel</button>
                    <button type="button" class="btn-primary" onclick="saveInlineIntraStrategy('${s.id}')" style="padding: 6px 18px; font-size: 12px; font-weight: 800; background: linear-gradient(135deg, #1e3a8a, #2563eb); border-color: #1e3a8a;">💾 Save Changes</button>
                </div>
            </div>`;
        }

        function buildPosInlineEditPanel(s) {
            const expOptions = buildExpirySelectOptions(s.index_name || 'NIFTY', s.expiry);
            return `
            <div id="stratEditPanel_${s.id}" style="display: block; background: #fdfbf7; border: 1px solid var(--pastel-blue-border); border-radius: var(--radius-sm); padding: 16px;">
                <div style="font-size: 13px; font-weight: 800; color: var(--accent-light); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <span>✏️ Edit Positional Strangle Configuration</span>
                    <span style="font-size: 10px; color: var(--text-muted); font-weight: 600;">Saved directly to strategy</span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Strategy Name</label>
                        <input type="text" id="inline_pos_name_${s.id}" value="${s.name || ''}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Underlying Index</label>
                        <select id="inline_pos_index_${s.id}" onchange="onInlinePosIndexChange('${s.id}')" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="NIFTY" ${s.index_name === 'NIFTY' ? 'selected' : ''}>NIFTY 50</option>
                            <option value="BANKNIFTY" ${s.index_name === 'BANKNIFTY' ? 'selected' : ''}>BANKNIFTY</option>
                            <option value="FINNIFTY" ${s.index_name === 'FINNIFTY' ? 'selected' : ''}>FINNIFTY</option>
                            <option value="MIDCPNIFTY" ${s.index_name === 'MIDCPNIFTY' ? 'selected' : ''}>MIDCPNIFTY</option>
                            <option value="SENSEX" ${s.index_name === 'SENSEX' ? 'selected' : ''}>SENSEX</option>
                            <option value="BANKEX" ${s.index_name === 'BANKEX' ? 'selected' : ''}>BANKEX</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Expiry Contract</label>
                        <select id="inline_pos_expiry_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            ${expOptions}
                        </select>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Entry Action</label>
                        <select id="inline_pos_action_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="SELL" ${(s.entry_action || 'SELL') === 'SELL' ? 'selected' : ''}>🔴 Short / Sell</option>
                            <option value="BUY" ${s.entry_action === 'BUY' ? 'selected' : ''}>🟢 Long / Buy</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Product</label>
                        <select id="inline_pos_product_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="NRML" ${(s.product || 'NRML') === 'NRML' ? 'selected' : ''}>NRML (Positional)</option>
                            <option value="MIS" ${s.product === 'MIS' ? 'selected' : ''}>MIS (Intraday)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Quantity</label>
                        <input type="number" id="inline_pos_qty_${s.id}" value="${s.quantity || 65}" min="1" step="1" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Max Re-entries</label>
                        <input type="number" id="inline_pos_reentry_${s.id}" value="${s.reentry_count !== undefined ? s.reentry_count : 1}" min="0" max="10" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Call Target Prem (₹)</label>
                        <input type="number" id="inline_pos_ce_prem_${s.id}" value="${s.ce_premium || 80}" step="0.5" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Put Target Prem (₹)</label>
                        <input type="number" id="inline_pos_pe_prem_${s.id}" value="${s.pe_premium || 80}" step="0.5" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">CE SL (%)</label>
                        <input type="number" id="inline_pos_ce_sl_${s.id}" value="${s.ce_sl_percent || s.sl_percent || 50}" step="1" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">PE SL (%)</label>
                        <input type="number" id="inline_pos_pe_sl_${s.id}" value="${s.pe_sl_percent || s.sl_percent || 50}" step="1" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Target Profit (%)</label>
                        <input type="number" id="inline_pos_tp_${s.id}" value="${s.tp_percent || 70}" step="1" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                            <input type="checkbox" id="inline_pos_enable_tsl_${s.id}" ${s.enable_tsl ? 'checked' : ''} style="margin: 0;">
                            <span>Enable TSL (Pts)</span>
                        </label>
                        <input type="number" id="inline_pos_tsl_pts_${s.id}" value="${s.tsl_points || 10}" min="1" step="1" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Entry Time</label>
                        <input type="time" step="1" id="inline_pos_entry_time_${s.id}" value="${s.entry_time || '15:00:00'}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Morning SL Time</label>
                        <input type="time" step="1" id="inline_pos_morning_sl_${s.id}" value="${s.morning_sl_time || '09:17:00'}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Exit Time</label>
                        <input type="time" step="1" id="inline_pos_exit_time_${s.id}" value="${s.exit_time || '15:15:00'}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                    <button type="button" class="btn-secondary" onclick="switchOpstraSubtab('${s.id}', 'PAYOFF')" style="padding: 6px 14px; font-size: 12px; font-weight: 700;">❌ Cancel</button>
                    <button type="button" class="btn-primary" onclick="saveInlinePosStrategy('${s.id}')" style="padding: 6px 18px; font-size: 12px; font-weight: 800; background: linear-gradient(135deg, #1e3a8a, #2563eb); border-color: #1e3a8a;">💾 Save Changes</button>
                </div>
            </div>`;
        }

        function buildStraddleInlineEditPanel(s) {
            const expOptions = buildExpirySelectOptions(s.index_name || 'NIFTY', s.expiry);
            const stratType = s.strategy_type || 'STRADDLE';
            const legSel = s.leg_selection || 'BOTH';
            const strikeMode = s.strike_mode || 'ATM';
            const slMode = s.sl_mode || 'PERCENT';
            const slVal = s.sl_value !== undefined ? s.sl_value : (s.total_sl_percent || 100);
            const tpVal = s.tp_value !== undefined ? s.tp_value : (s.total_tp_percent || 50);

            return `
            <div id="stratEditPanel_${s.id}" style="display: block; background: #fdfbf7; border: 1px solid var(--pastel-blue-border); border-radius: var(--radius-sm); padding: 16px;">
                <div style="font-size: 13px; font-weight: 800; color: var(--accent-light); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <span>✏️ Edit Straddle Total SL Configuration</span>
                    <span style="font-size: 10px; color: var(--text-muted); font-weight: 600;">Full inline configuration control</span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Strategy Name</label>
                        <input type="text" id="inline_straddle_name_${s.id}" value="${s.name || ''}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Group Name</label>
                        <input type="text" id="inline_straddle_group_${s.id}" value="${s.group_name || 'Straddle'}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Underlying Index</label>
                        <select id="inline_straddle_index_${s.id}" onchange="onInlineStraddleIndexChange('${s.id}')" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="NIFTY" ${s.index_name === 'NIFTY' ? 'selected' : ''}>NIFTY 50</option>
                            <option value="BANKNIFTY" ${s.index_name === 'BANKNIFTY' ? 'selected' : ''}>BANKNIFTY</option>
                            <option value="FINNIFTY" ${s.index_name === 'FINNIFTY' ? 'selected' : ''}>FINNIFTY</option>
                            <option value="MIDCPNIFTY" ${s.index_name === 'MIDCPNIFTY' ? 'selected' : ''}>MIDCPNIFTY</option>
                            <option value="SENSEX" ${s.index_name === 'SENSEX' ? 'selected' : ''}>SENSEX</option>
                            <option value="BANKEX" ${s.index_name === 'BANKEX' ? 'selected' : ''}>BANKEX</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Expiry Contract</label>
                        <select id="inline_straddle_expiry_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            ${expOptions}
                        </select>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Strategy Structure</label>
                        <select id="inline_straddle_type_${s.id}" onchange="onInlineStraddleTypeChange('${s.id}')" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="STRADDLE" ${stratType === 'STRADDLE' ? 'selected' : ''}>Straddle (ATM / Multiple)</option>
                            <option value="STRANGLE" ${stratType === 'STRANGLE' ? 'selected' : ''}>Strangle (Separate Legs)</option>
                            <option value="INDIVIDUAL_LEG" ${stratType === 'INDIVIDUAL_LEG' ? 'selected' : ''}>Individual Leg (CE or PE)</option>
                        </select>
                    </div>
                    <div id="inline_straddle_leg_sel_row_${s.id}" style="display: ${stratType === 'INDIVIDUAL_LEG' ? 'block' : 'none'};">
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Leg Selection</label>
                        <select id="inline_straddle_leg_sel_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="BOTH" ${legSel === 'BOTH' ? 'selected' : ''}>Both Legs</option>
                            <option value="CE_ONLY" ${legSel === 'CE_ONLY' ? 'selected' : ''}>CE Only</option>
                            <option value="PE_ONLY" ${legSel === 'PE_ONLY' ? 'selected' : ''}>PE Only</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Underlying Base</label>
                        <select id="inline_straddle_und_type_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="CASH" ${(s.underlying_type || 'CASH') === 'CASH' ? 'selected' : ''}>Cash / Spot Index</option>
                            <option value="FUTURES" ${s.underlying_type === 'FUTURES' ? 'selected' : ''}>Futures Contract</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Strike Selection Mode</label>
                        <select id="inline_straddle_strike_mode_${s.id}" onchange="onInlineStraddleStrikeModeChange('${s.id}')" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="ATM" ${strikeMode === 'ATM' ? 'selected' : ''}>ATM Strike</option>
                            <option value="ROUND_OFF" ${strikeMode === 'ROUND_OFF' ? 'selected' : ''}>Nearest Round-Off Multiple</option>
                            <option value="MANUAL" ${strikeMode === 'MANUAL' ? 'selected' : ''}>Manual Fixed Strike</option>
                            <option value="PREMIUM" ${strikeMode === 'PREMIUM' ? 'selected' : ''}>Target Premium Closest</option>
                        </select>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div id="inline_straddle_round_row_${s.id}" style="display: ${strikeMode === 'ROUND_OFF' ? 'block' : 'none'};">
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Strike Multiple</label>
                        <input type="number" id="inline_straddle_strike_mult_${s.id}" value="${s.strike_multiple || 500}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div id="inline_straddle_manual_row_${s.id}" style="display: ${strikeMode === 'MANUAL' ? 'block' : 'none'};">
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Manual Strike</label>
                        <input type="number" id="inline_straddle_manual_strike_${s.id}" value="${s.manual_strike || ''}" placeholder="e.g. 24500" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div id="inline_straddle_prem_row_${s.id}" style="display: ${strikeMode === 'PREMIUM' ? 'block' : 'none'};">
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Target Premiums (CE / PE)</label>
                        <div style="display: flex; gap: 6px;">
                            <input type="number" id="inline_straddle_ce_prem_${s.id}" value="${s.ce_target_premium || 80}" placeholder="CE ₹" style="flex: 1; padding: 6px 8px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <input type="number" id="inline_straddle_pe_prem_${s.id}" value="${s.pe_target_premium || 80}" placeholder="PE ₹" style="flex: 1; padding: 6px 8px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                        </div>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Entry Action</label>
                        <select id="inline_straddle_action_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="SELL" ${(s.entry_action || 'SELL') === 'SELL' ? 'selected' : ''}>🔴 Short / Sell</option>
                            <option value="BUY" ${s.entry_action === 'BUY' ? 'selected' : ''}>🟢 Long / Buy</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Product</label>
                        <select id="inline_straddle_product_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="NRML" ${(s.product || 'NRML') === 'NRML' ? 'selected' : ''}>NRML (Positional)</option>
                            <option value="MIS" ${s.product === 'MIS' ? 'selected' : ''}>MIS (Intraday)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Quantity</label>
                        <input type="number" id="inline_straddle_qty_${s.id}" value="${s.quantity || 65}" min="1" step="1" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">SL Mode</label>
                        <select id="inline_straddle_sl_mode_${s.id}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <option value="PERCENT" ${slMode === 'PERCENT' ? 'selected' : ''}>Percentage (%)</option>
                            <option value="POINTS" ${slMode === 'POINTS' ? 'selected' : ''}>Points</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Total SL Value</label>
                        <input type="number" id="inline_straddle_sl_val_${s.id}" value="${slVal}" step="0.5" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Total TP Value</label>
                        <input type="number" id="inline_straddle_tp_val_${s.id}" value="${tpVal}" step="0.5" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                            <input type="checkbox" id="inline_straddle_enable_tsl_${s.id}" ${s.enable_tsl ? 'checked' : ''} style="margin: 0;">
                            <span>Enable TSL</span>
                        </label>
                        <div style="display: flex; gap: 6px;">
                            <input type="number" id="inline_straddle_tsl_step_${s.id}" value="${s.tsl_step || 10}" placeholder="Step" title="TSL Step" style="flex: 1; padding: 6px 8px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                            <input type="number" id="inline_straddle_tsl_val_${s.id}" value="${s.tsl_value || 10}" placeholder="Val" title="TSL Value" style="flex: 1; padding: 6px 8px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                        </div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Entry Time</label>
                        <input type="time" step="1" id="inline_straddle_entry_time_${s.id}" value="${s.entry_time || '15:00:00'}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;" title="0 = Exit on Expiry Day, 1 = Exit 1 day before expiry, etc.">Exit Days Before Expiry</label>
                        <input type="number" id="inline_straddle_exit_days_${s.id}" value="${s.exit_days_to_expiry !== undefined ? s.exit_days_to_expiry : 0}" min="0" max="30" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 700; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 3px;">Exit Time</label>
                        <input type="time" step="1" id="inline_straddle_exit_time_${s.id}" value="${s.exit_time || '15:15:00'}" style="width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #ffffff;">
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                    <button type="button" class="btn-secondary" onclick="switchOpstraSubtab('${s.id}', 'PAYOFF')" style="padding: 6px 14px; font-size: 12px; font-weight: 700;">❌ Cancel</button>
                    <button type="button" class="btn-primary" onclick="saveInlineStraddleStrategy('${s.id}')" style="padding: 6px 18px; font-size: 12px; font-weight: 800; background: linear-gradient(135deg, #1e3a8a, #2563eb); border-color: #1e3a8a;">💾 Save Changes</button>
                </div>
            </div>`;
        }

        // ═══════════════════════════════════════════════════════════════
        // OPSTRA ANALYTICS, PAYOFF DIAGRAMS & GREEKS ENGINE
        // ═══════════════════════════════════════════════════════════════

        const opstraSubtabState = {}; // stratId -> 'PAYOFF' | 'GREEKS' | 'PNL' | 'EDIT'
        const opstraPayoffCharts = {}; // stratId -> Chart instance
        const opstraChartSignatures = {}; // stratId -> last rendered signature
        let posFilterInstrumentState = 'ALL';
        let straddlePillFilterState = 'ALL';

        function getOpstraSubtab(stratId) {
            return opstraSubtabState[stratId] || 'PAYOFF';
        }

        function getStrategyChartSignature(strat, metrics) {
            if (!strat || !metrics || !metrics.legs) return '';
            const legsSig = (metrics.legs || []).map(l => `${l.type}_${l.strike}_${l.action}_${l.qty}_${l.entry.toFixed(2)}`).join('|');
            const spotRef = Math.round(metrics.spot || 0);
            return `${strat.id}_${strat.index_name}_${strat.expiry}_${legsSig}_${spotRef}`;
        }

        function switchOpstraSubtab(stratId, tabName) {
            opstraSubtabState[stratId] = tabName;
            
            // Toggle tab buttons
            const nav = document.getElementById(`opstraSubtabsNav_${stratId}`);
            if (nav) {
                nav.querySelectorAll('.opstra-subtab-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === tabName);
                });
            }

            // Toggle panes
            const panes = ['payoff', 'greeks', 'pnl', 'edit'];
            panes.forEach(p => {
                const el = document.getElementById(`opstraPane_${p}_${stratId}`);
                if (el) {
                    el.style.display = (p.toUpperCase() === tabName) ? 'block' : 'none';
                }
            });

            // If switching to payoff, trigger chart resize/render
            if (tabName === 'PAYOFF') {
                const strat = (loadedPosStrategies || []).find(s => s.id === stratId) || (loadedStraddleStrategies || []).find(s => s.id === stratId);
                if (strat) {
                    setTimeout(() => renderOpstraPayoffChart(stratId, strat), 50);
                }
            }
        }

        // Standard Normal cumulative distribution function (approximation) for POP
        function standardNormalCDF(x) {
            const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
            const d = 0.3989422804014327 * Math.exp(-x * x / 2.0);
            let prob = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
            if (x > 0) prob = 1.0 - prob;
            return prob;
        }

        function extractStrategyLegs(strat) {
            const legs = [];
            const isSell = (strat.entry_action || 'SELL').toUpperCase() === 'SELL';
            const baseQty = parseInt(strat.quantity || getBrokerLotSize(strat.index_name || 'NIFTY'));

            // Check if orders placed
            const ceOrder = strat.orders && strat.orders.CE;
            const peOrder = strat.orders && strat.orders.PE;

            if (ceOrder && ceOrder.symbol) {
                const strike = parseFloat(ceOrder.strike || strat.selected_ce_strike || (ceOrder.symbol.match(/\d+(?=CE)/) || [0])[0]);
                const entry = parseFloat(ceOrder.entry_price || strat.selected_ce_ltp || 0);
                const ltp = parseFloat(ceOrder.current_ltp || strat.selected_ce_ltp || entry);
                const qty = parseInt(ceOrder.quantity || baseQty);
                const action = (ceOrder.action || (isSell ? 'SELL' : 'BUY')).toUpperCase();
                legs.push({ type: 'CE', strike, entry, ltp, qty, action, symbol: ceOrder.symbol, greeks: ceOrder.greeks });
            } else if (strat.selected_ce || strat.selected_ce_strike || (strat.selected_strike && strat.leg_selection !== 'PE_ONLY')) {
                const strike = parseFloat(strat.selected_ce_strike || strat.selected_strike || 0);
                const entry = parseFloat(strat.selected_ce_ltp || strat.ce_premium || strat.ce_target_premium || 0);
                const ltp = parseFloat(strat.selected_ce_ltp || entry);
                const symbol = strat.selected_ce || `${strat.index_name || 'OPT'} ${strike} CE`;
                legs.push({ type: 'CE', strike, entry, ltp, qty: baseQty, action: isSell ? 'SELL' : 'BUY', symbol, greeks: null });
            }

            if (peOrder && peOrder.symbol) {
                const strike = parseFloat(peOrder.strike || strat.selected_pe_strike || (peOrder.symbol.match(/\d+(?=PE)/) || [0])[0]);
                const entry = parseFloat(peOrder.entry_price || strat.selected_pe_ltp || 0);
                const ltp = parseFloat(peOrder.current_ltp || strat.selected_pe_ltp || entry);
                const qty = parseInt(peOrder.quantity || baseQty);
                const action = (peOrder.action || (isSell ? 'SELL' : 'BUY')).toUpperCase();
                legs.push({ type: 'PE', strike, entry, ltp, qty, action, symbol: peOrder.symbol, greeks: peOrder.greeks });
            } else if (strat.selected_pe || strat.selected_pe_strike || (strat.selected_strike && strat.leg_selection !== 'CE_ONLY')) {
                const strike = parseFloat(strat.selected_pe_strike || strat.selected_strike || 0);
                const entry = parseFloat(strat.selected_pe_ltp || strat.pe_premium || strat.pe_target_premium || 0);
                const ltp = parseFloat(strat.selected_pe_ltp || entry);
                const symbol = strat.selected_pe || `${strat.index_name || 'OPT'} ${strike} PE`;
                legs.push({ type: 'PE', strike, entry, ltp, qty: baseQty, action: isSell ? 'SELL' : 'BUY', symbol, greeks: null });
            }

            // Also include active adjustment legs if present
            if (strat.adjustments && strat.adjustments.active_orders) {
                Object.values(strat.adjustments.active_orders).forEach(adj => {
                    if (adj.status === 'ACTIVE' && adj.symbol) {
                        const isCE = adj.symbol.toUpperCase().includes('CE');
                        const strikeMatch = adj.symbol.match(/\d+(?=(CE|PE))/);
                        const strike = strikeMatch ? parseFloat(strikeMatch[0]) : 0;
                        legs.push({
                            type: isCE ? 'CE' : 'PE',
                            strike: strike,
                            entry: parseFloat(adj.entry_price || 0),
                            ltp: parseFloat(adj.current_ltp || adj.entry_price || 0),
                            qty: parseInt(adj.quantity || baseQty),
                            action: (adj.action || 'SELL').toUpperCase(),
                            symbol: adj.symbol,
                            greeks: adj.greeks
                        });
                    }
                });
            }

            return legs;
        }

        function calculateOpstraMetrics(strat) {
            const legs = extractStrategyLegs(strat);
            const spot = parseFloat(strat.underlying_ltp || strat.base_spot_entry || strat.entry_underlying_ltp || strat.underlying_calc_ltp || 0);
            
            if (legs.length === 0 || !legs.some(l => l.strike > 0)) {
                return {
                    hasData: false,
                    pop: '--',
                    maxProfit: '--',
                    maxLoss: '--',
                    rrRatio: '--',
                    breakevens: ['--'],
                    totalPnl: getStrategyPnl(strat),
                    netCredit: 0,
                    estMargin: '--',
                    spot: spot || 0,
                    legs: legs
                };
            }

            // Calculate Net Credit / Debit
            let netCashflow = 0;
            let totalLotQty = 0;
            legs.forEach(l => {
                const cost = (l.entry > 0 ? l.entry : l.ltp) * l.qty;
                if (l.action === 'SELL') {
                    netCashflow += cost;
                } else {
                    netCashflow -= cost;
                }
                totalLotQty = Math.max(totalLotQty, l.qty);
            });

            // Calculate Spot Reference (if spot is 0, estimate from strikes)
            let effectiveSpot = spot;
            if (!effectiveSpot || effectiveSpot <= 0) {
                const strikes = legs.map(l => l.strike).filter(k => k > 0);
                if (strikes.length > 0) {
                    effectiveSpot = strikes.reduce((a, b) => a + b, 0) / strikes.length;
                } else {
                    effectiveSpot = 24000; // reasonable fallback
                }
            }

            // Sweep spot prices across +/- 15% in steps of 0.25%
            const minSpot = Math.floor(effectiveSpot * 0.85);
            const maxSpot = Math.ceil(effectiveSpot * 1.15);
            const step = Math.max(10, Math.round((maxSpot - minSpot) / 120));

            const spotPoints = [];
            const expiryPayouts = [];
            let maxP = -Infinity;
            let minP = Infinity;
            const beCrossings = [];

            let prevPnl = null;
            let prevS = null;

            for (let s = minSpot; s <= maxSpot; s += step) {
                let payoutAtS = 0;
                legs.forEach(l => {
                    const prem = (l.entry > 0 ? l.entry : l.ltp);
                    let intrinsic = 0;
                    if (l.type === 'CE') {
                        intrinsic = Math.max(0, s - l.strike);
                    } else {
                        intrinsic = Math.max(0, l.strike - s);
                    }

                    if (l.action === 'SELL') {
                        payoutAtS += (prem - intrinsic) * l.qty;
                    } else {
                        payoutAtS += (intrinsic - prem) * l.qty;
                    }
                });

                spotPoints.push(s);
                expiryPayouts.push(payoutAtS);

                if (payoutAtS > maxP) maxP = payoutAtS;
                if (payoutAtS < minP) minP = payoutAtS;

                // Check for breakeven zero crossing
                if (prevPnl !== null) {
                    if ((prevPnl < 0 && payoutAtS >= 0) || (prevPnl >= 0 && payoutAtS < 0)) {
                        // linear interpolation
                        const fraction = Math.abs(prevPnl) / (Math.abs(prevPnl) + Math.abs(payoutAtS) + 0.0001);
                        const bePrice = prevS + fraction * (s - prevS);
                        beCrossings.push(Math.round(bePrice));
                    }
                }
                prevPnl = payoutAtS;
                prevS = s;
            }

            // Estimate Probability of Profit (POP)
            let popStr = '68%';
            if (beCrossings.length >= 2) {
                const lowBe = Math.min(...beCrossings);
                const highBe = Math.max(...beCrossings);
                const iv = parseFloat((strat.greeks && strat.greeks.avg_iv) || 14) / 100;
                const dte = Math.max(1, parseInt(strat.exit_days_to_expiry || 7));
                const tYear = dte / 365.0;
                const sigma = effectiveSpot * iv * Math.sqrt(tYear);

                if (sigma > 0) {
                    const zLow = (lowBe - effectiveSpot) / sigma;
                    const zHigh = (highBe - effectiveSpot) / sigma;
                    const cdfLow = standardNormalCDF(zLow);
                    const cdfHigh = standardNormalCDF(zHigh);
                    const prob = Math.min(99, Math.max(1, Math.round((cdfHigh - cdfLow) * 100)));
                    popStr = `${prob}%`;
                }
            } else if (beCrossings.length === 1) {
                popStr = '52%';
            }

            // Max Profit / Max Loss display
            const isUncappedProfit = (expiryPayouts[0] > maxP * 0.95 && expiryPayouts[expiryPayouts.length - 1] > maxP * 0.95);
            const isUncappedLoss = (expiryPayouts[0] < -500000 || expiryPayouts[expiryPayouts.length - 1] < -500000 || minP < -1000000);

            const maxProfitStr = isUncappedProfit ? 'Unlimited' : `₹${Math.round(maxP).toLocaleString('en-IN')}`;
            const maxLossStr = isUncappedLoss ? 'Undefined' : `₹${Math.round(Math.abs(minP)).toLocaleString('en-IN')}`;

            let rrRatio = 'NA';
            if (!isUncappedProfit && !isUncappedLoss && minP !== 0) {
                const ratio = Math.abs(maxP / minP).toFixed(2);
                rrRatio = `1:${ratio}`;
            }

            // Estimated Margin Calculation
            const lotSize = getBrokerLotSize(strat.index_name || 'NIFTY');
            const numLots = Math.max(1, Math.round(totalLotQty / lotSize));
            const marginPerLot = (strat.index_name === 'BANKNIFTY' ? 85000 : 75000);
            const estMargin = `₹${((numLots * marginPerLot) / 100000).toFixed(2)} L`;

            return {
                hasData: true,
                pop: popStr,
                maxProfit: maxProfitStr,
                maxLoss: maxLossStr,
                rrRatio: rrRatio,
                breakevens: beCrossings.length > 0 ? beCrossings : ['--'],
                totalPnl: getStrategyPnl(strat),
                netCredit: netCashflow,
                estMargin: estMargin,
                spot: effectiveSpot,
                spotPoints: spotPoints,
                expiryPayouts: expiryPayouts,
                legs: legs
            };
        }

        function renderOpstraPayoffChart(stratId, strat) {
            const canvas = document.getElementById(`opstraPayoffCanvas_${stratId}`);
            if (!canvas) return;

            const metrics = calculateOpstraMetrics(strat);
            if (!metrics.hasData || !metrics.spotPoints) return;

            const newSignature = getStrategyChartSignature(strat, metrics);
            const existingChart = opstraPayoffCharts[stratId];

            // If chart already exists and its structural curve parameters haven't changed, skip replotting
            if (existingChart && opstraChartSignatures[stratId] === newSignature) {
                return;
            }

            const zeroLine = metrics.spotPoints.map(() => 0);

            // If chart exists, smoothly update its data without destroying and flashing canvas
            if (existingChart && canvas.dataset.initialized === 'true') {
                try {
                    existingChart.data.labels = metrics.spotPoints;
                    existingChart.data.datasets[0].data = metrics.expiryPayouts;
                    existingChart.data.datasets[1].data = zeroLine;
                    existingChart.update('none'); // Update without animation to remain perfectly static
                    opstraChartSignatures[stratId] = newSignature;
                    return;
                } catch(e) {
                    try { existingChart.destroy(); } catch(err){}
                }
            }

            // Destroy existing chart before new instantiation
            if (opstraPayoffCharts[stratId]) {
                try { opstraPayoffCharts[stratId].destroy(); } catch(e){}
            }

            const ctx = canvas.getContext('2d');
            canvas.dataset.initialized = 'true';

            opstraPayoffCharts[stratId] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: metrics.spotPoints,
                    datasets: [
                        {
                            label: 'Expiry P&L (₹)',
                            data: metrics.expiryPayouts,
                            borderColor: '#0284c7',
                            borderWidth: 2.5,
                            pointRadius: 0,
                            tension: 0.1,
                            fill: {
                                target: 'origin',
                                above: 'rgba(34, 197, 94, 0.15)',
                                below: 'rgba(239, 68, 68, 0.15)'
                            }
                        },
                        {
                            label: 'Breakeven Zero Line',
                            data: zeroLine,
                            borderColor: '#94a3b8',
                            borderWidth: 1,
                            borderDash: [4, 4],
                            pointRadius: 0,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false, // Static display without recurring animations
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                boxWidth: 12,
                                font: { size: 10, weight: '700' }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                title: function(context) {
                                    return `Spot: ₹${Number(context[0].label).toLocaleString('en-IN')}`;
                                },
                                label: function(context) {
                                    const val = Number(context.raw || 0);
                                    return `Payout: ₹${Math.round(val).toLocaleString('en-IN')}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(226, 232, 240, 0.6)' },
                            ticks: {
                                maxTicksLimit: 8,
                                font: { size: 10, family: 'JetBrains Mono' },
                                callback: function(val) {
                                    return `₹${Math.round(this.getLabelForValue(val))}`;
                                }
                            }
                        },
                        y: {
                            grid: { color: 'rgba(226, 232, 240, 0.6)' },
                            ticks: {
                                font: { size: 10, family: 'JetBrains Mono' },
                                callback: function(val) {
                                    return `₹${val >= 0 ? '+' : ''}${Math.round(val).toLocaleString('en-IN')}`;
                                }
                            }
                        }
                    }
                }
            });

            opstraChartSignatures[stratId] = newSignature;
        }

        function setPosFilterInstrument(inst) {
            posFilterInstrumentState = inst;
            document.querySelectorAll('#posFilterBar .opstra-pill-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.inst === inst);
            });
            renderPosInstrumentGroups(loadedPosStrategies);
        }

        function setStraddlePillFilter(inst) {
            straddlePillFilterState = inst;
            document.querySelectorAll('#straddleFilterBar .opstra-pill-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.inst === inst);
            });
            if (document.getElementById('straddleFilterInstrument')) {
                document.getElementById('straddleFilterInstrument').value = inst;
            }
            applyStraddleFilters();
        }

        function expandAllCards(scope) {
            const container = (scope === 'POS') ? document.getElementById('posInstrumentGroupsContainer') : document.getElementById('straddleInstrumentGroupsContainer');
            if (!container) return;
            container.querySelectorAll('.opstra-strat-card').forEach(card => {
                const id = card.dataset.stratId;
                if (id) toggleStrategyCard(id, true);
            });
        }

        function collapseAllCards(scope) {
            const container = (scope === 'POS') ? document.getElementById('posInstrumentGroupsContainer') : document.getElementById('straddleInstrumentGroupsContainer');
            if (!container) return;
            container.querySelectorAll('.opstra-strat-card').forEach(card => {
                const id = card.dataset.stratId;
                if (id) {
                    stratCardCollapseState[id] = true;
                    try { localStorage.setItem('tbs_strat_card_collapse_state', JSON.stringify(stratCardCollapseState)); } catch(e){}
                    const body = document.getElementById(`stratCardBody_${id}`);
                    const chevron = document.getElementById(`stratCardChevron_${id}`);
                    if (body) body.style.display = 'none';
                    if (chevron) chevron.classList.add('collapsed');
                }
            });
        }

        function selectAllCards(scope) {
            const container = (scope === 'POS') ? document.getElementById('posInstrumentGroupsContainer') : document.getElementById('straddleInstrumentGroupsContainer');
            if (!container) return;
            const checkboxes = container.querySelectorAll('.opstra-card-chk');
            const allChecked = Array.from(checkboxes).every(c => c.checked);
            checkboxes.forEach(c => { c.checked = !allChecked; });
        }

        // ═══════════════════════════════════════════════════════════════
        // AUDIO FEEDBACK & INTERACTION SYSTEM (Web Audio API)
        // ═══════════════════════════════════════════════════════════════
        let audioCtx = null;
        function getAudioContext() {
            if (!audioCtx) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) {
                    audioCtx = new AudioContextClass();
                }
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => { });
            }
            return audioCtx;
        }

        function playClickSound(tone = 'standard') {
            try {
                const ctx = getAudioContext();
                if (!ctx) return;

                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);

                const now = ctx.currentTime;
                if (tone === 'danger') {
                    // Lower pitched crisp click for danger / delete / stop
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(320, now);
                    osc.frequency.exponentialRampToValueAtTime(140, now + 0.06);
                    gain.gain.setValueAtTime(0.2, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
                    osc.start(now);
                    osc.stop(now + 0.06);
                } else if (tone === 'action') {
                    // Bright ascending click for run / save / calc
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(600, now);
                    osc.frequency.exponentialRampToValueAtTime(900, now + 0.05);
                    gain.gain.setValueAtTime(0.18, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
                    osc.start(now);
                    osc.stop(now + 0.05);
                } else {
                    // Standard snappy haptic mechanical UI click
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(800, now);
                    osc.frequency.exponentialRampToValueAtTime(280, now + 0.045);
                    gain.gain.setValueAtTime(0.22, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
                    osc.start(now);
                    osc.stop(now + 0.045);
                }
            } catch (e) { }
        }

        // Global Event Delegation for Dynamic Button Audio & Visual Feedback
        document.addEventListener('pointerdown', (e) => {
            const btn = e.target.closest('button, .btn, .btn-primary, .btn-secondary, .btn-danger, .tab-btn, .nav-tab, .btn-logout, a.btn');
            if (!btn || btn.disabled) return;

            // Determine tone
            const isDanger = btn.classList.contains('btn-danger') || btn.textContent.includes('Delete') || btn.textContent.includes('Stop');
            const isAction = btn.classList.contains('btn-primary') || btn.textContent.includes('Save') || btn.textContent.includes('Run');
            const tone = isDanger ? 'danger' : (isAction ? 'action' : 'standard');

            playClickSound(tone);
        });

        function toast(msg) {
            const c = document.getElementById('toastContainer');
            const el = document.createElement('div');
            el.className = 'toast';
            el.textContent = msg;
            c.appendChild(el);
            setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
        }

        async function api(path, method = 'GET', body = null) {
            const opts = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) opts.body = JSON.stringify(body);
            const res = await fetch(API + path, opts);
            if (!res.ok) {
                let errorMsg = `Server error ${res.status}: ${res.statusText}`;
                try {
                    const errJson = await res.json();
                    if (errJson && errJson.message) errorMsg = errJson.message;
                } catch (e) { }
                return { status: 'error', message: errorMsg };
            }
            return res.json();
        }

        function toggleCredFields() {
            const btn = document.getElementById('credToggle');
            const fields = document.getElementById('credFields');
            if (!fields) return;
            const isHidden = fields.classList.contains('hidden') || fields.style.display === 'none';
            if (isHidden) {
                fields.classList.remove('hidden');
                fields.style.display = 'block';
                if (btn) btn.classList.add('open');
            } else {
                fields.classList.add('hidden');
                fields.style.display = 'none';
                if (btn) btn.classList.remove('open');
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // CREDENTIALS & AUTHLOGIN
        // ═══════════════════════════════════════════════════════════════

        async function loadCredentials() {
            const data = await api('/api/credentials');
            if (data.api_key) {
                document.getElementById('apiKey').value = data.api_key;
                document.getElementById('lnkGetToken').href = `https://kite.zerodha.com/connect/login?api_key=${data.api_key}&v=3`;
            }
            if (data.api_secret) document.getElementById('apiSecret').value = data.api_secret;
            if (data.username) document.getElementById('username').value = data.username;
            if (data.password) document.getElementById('password').value = data.password;
        }

        async function saveCredentials(event) {
            if (event && event.preventDefault) event.preventDefault();
            const btn = document.getElementById('btnSaveCreds');
            const origHtml = btn ? btn.innerHTML : '💾 Save Credentials';
            
            const payload = {
                api_key: (document.getElementById('apiKey')?.value || '').trim(),
                api_secret: (document.getElementById('apiSecret')?.value || '').trim(),
                username: (document.getElementById('username')?.value || '').trim(),
                password: (document.getElementById('password')?.value || '').trim(),
            };

            if (!payload.api_key || !payload.api_secret) {
                toast('⚠️ Please provide at least API Key and API Secret');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ Saving...';
            }

            try {
                const res = await api('/api/credentials', 'POST', payload);
                if (res && res.status === 'ok') {
                    toast('✅ Credentials saved successfully!');
                    const lnk = document.getElementById('lnkGetToken');
                    if (lnk) lnk.href = `https://kite.zerodha.com/connect/login?api_key=${payload.api_key}&v=3`;
                } else {
                    toast('❌ Error saving credentials: ' + (res?.message || 'Server error'));
                }
            } catch (err) {
                console.error("Save credentials error:", err);
                toast('❌ Network error saving credentials');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                }
            }
        }

        async function doAutoLogin() {
            const res = await api('/api/login/auto', 'POST');
            if (res.status === 'ok') {
                toast(res.message);
                showDashboard(res.user_name);
            } else if (res.status === 'need_totp') {
                toast(res.message);
            }
        }

        function getTotpCode() {
            return (document.getElementById('totpInput').value || '').replace(/\D/g, '').trim();
        }

        async function doTotpLogin() {
            const code = getTotpCode();
            if (code.length !== 6) { toast('Enter 6 digit TOTP', true); return; }
            const btn = document.getElementById('btnTotpLogin');
            const origText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="btn-text">⏳ Verifying TOTP with Zerodha...</span>';
            }

            try {
                const res = await api('/api/login/totp', 'POST', { totp: code });
                if (res.status === 'ok') {
                    toast('✅ ' + (res.message || 'Login successful'));
                    showDashboard(res.user_name);
                } else {
                    toast('❌ ' + (res.message || 'TOTP Login failed'), true);
                }
            } catch (err) {
                toast('❌ Login error: ' + err.message, true);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origText;
                }
            }
        }

        async function doAutoLogin() {
            const btn = document.getElementById('btnAutoLogin');
            const origText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="btn-text">⏳ Checking Cached Session...</span>';
            }

            try {
                const res = await api('/api/login/auto', 'POST');
                if (res.status === 'ok') {
                    toast('✅ ' + (res.message || 'Connected to Kite'));
                    showDashboard(res.user_name);
                } else {
                    toast('ℹ️ ' + (res.message || 'Please enter fresh TOTP'), true);
                }
            } catch (err) {
                toast('❌ Session error: ' + err.message, true);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origText;
                }
            }
        }

        async function doTokenLogin() {
            const token = document.getElementById('accessToken').value.trim();
            if (!token) { toast('Enter access token', true); return; }
            const btn = document.getElementById('btnTokenLogin');
            const origText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="btn-text">⏳ Connecting...</span>';
            }

            try {
                const res = await api('/api/login/access-token', 'POST', { access_token: token });
                if (res.status === 'ok') {
                    toast('✅ ' + (res.message || 'Connected'));
                    showDashboard(res.user_name);
                } else {
                    toast('❌ ' + (res.message || 'Login failed'), true);
                }
            } catch (err) {
                toast('❌ Token error: ' + err.message, true);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origText;
                }
            }
        }

        async function doLogout() {
            await api('/api/logout', 'POST');
            toast('Logged out');
            showLogin();
        }

        // TOTP Input listener & Enter key trigger
        const totpEl = document.getElementById('totpInput');
        if (totpEl) {
            totpEl.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '');
                if (e.target.value.length === 6) {
                    // Automatically trigger when 6 digits are typed
                    setTimeout(doTotpLogin, 100);
                }
            });
            totpEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    doTotpLogin();
                }
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // OPEN INTEREST (OI) DASHBOARD STATE & LOGIC
        // ═══════════════════════════════════════════════════════════════

        let dashOiIntervalTimer = null;
        let lastDashOiData = null;

        async function onDashIndexChange() {
            const index = document.getElementById('dashIndexSelect').value;
            const expirySelect = document.getElementById('dashExpirySelect');
            expirySelect.innerHTML = `<option value="CURRENT">Loading expiries...</option>`;
            
            try {
                const res = await api(`/api/options/expiries?index=${index}`);
                if (res.status === 'ok' && res.expiries && res.expiries.length > 0) {
                    expirySelect.innerHTML = res.expiries.map((exp, idx) => 
                        `<option value="${exp}">${exp} ${idx === 0 ? '(Nearest Expiry)' : ''}</option>`
                    ).join('');
                } else {
                    expirySelect.innerHTML = `<option value="CURRENT">Current Expiry</option><option value="NEXT">Next Expiry</option>`;
                }
            } catch (e) {
                expirySelect.innerHTML = `<option value="CURRENT">Current Expiry</option>`;
            }

            fetchDashboardOiAnalysis(true);
        }

        function toggleDashAutoRefresh(enabled) {
            const label = document.getElementById('dashAutoRefreshLabel');
            const select = document.getElementById('dashRefreshIntervalSelect');
            if (label) {
                label.textContent = enabled ? 'AUTO REFRESH: ON' : 'AUTO REFRESH: OFF';
                label.style.color = enabled ? '#16a34a' : '#94a3b8';
            }
            if (select) {
                select.disabled = !enabled;
                select.style.opacity = enabled ? '1' : '0.5';
            }

            if (!enabled) {
                if (dashOiIntervalTimer) {
                    clearInterval(dashOiIntervalTimer);
                    dashOiIntervalTimer = null;
                }
                toast('⏸️ Dashboard Auto-Refresh Paused (Polling stopped)');
            } else {
                onDashIntervalChange();
                toast('▶️ Dashboard Auto-Refresh Active');
            }
        }

        function onDashIntervalChange() {
            if (dashOiIntervalTimer) {
                clearInterval(dashOiIntervalTimer);
                dashOiIntervalTimer = null;
            }
            const isAutoOn = document.getElementById('dashAutoRefreshToggle')?.checked ?? false;
            if (!isAutoOn) return;

            const intervalMs = parseInt(document.getElementById('dashRefreshIntervalSelect')?.value || '10000');
            if (intervalMs > 0) {
                dashOiIntervalTimer = setInterval(() => {
                    if (document.getElementById('consoleView').style.display === 'block' && 
                        document.getElementById('tabDashboard').classList.contains('active')) {
                        fetchDashboardOiAnalysis();
                    }
                }, intervalMs);
            }
        }

        async function fetchDashboardOiAnalysis(showToast = false) {
            const index = document.getElementById('dashIndexSelect')?.value || 'NIFTY';
            const expiry = document.getElementById('dashExpirySelect')?.value || 'CURRENT';
            
            const syncEl = document.getElementById('dashLastSyncText');
            if (syncEl) syncEl.textContent = 'Syncing...';

            try {
                const res = await api(`/api/options/oi_analysis?index=${index}&expiry=${expiry}`);
                if (res.status === 'ok') {
                    lastDashOiData = res;
                    renderDashboardOiView(res);
                    if (syncEl) syncEl.textContent = `Sync: ${res.last_updated ? res.last_updated.split(' ')[1] : 'Just now'}`;
                    if (showToast) toast(`✅ Open Interest updated for ${index}`);
                } else {
                    if (syncEl) syncEl.textContent = 'Sync Error';
                    if (showToast) toast(`❌ ${res.message || 'Error fetching OI'}`, true);
                }
            } catch (e) {
                if (syncEl) syncEl.textContent = 'Sync Failed';
                if (showToast) toast(`❌ Network error while fetching OI`, true);
            }
        }

        function renderDashboardOiView(data) {
            if (!data) return;

            // 1. Spot LTP Display
            const spotPrice = parseFloat(data.spot_price || 0);
            document.getElementById('dashSpotLtpDisplay').textContent = spotPrice > 0 ? `Spot: ₹${spotPrice.toFixed(1)}` : 'Spot: --';

            // 2. Max CE OI Card (Resistance)
            const maxCe = data.max_ce || {};
            const ceStrike = maxCe.strike || '--';
            const ceLtp = parseFloat(maxCe.ltp || 0);
            const ceOi = parseInt(maxCe.oi || 0);
            const ceDiff = parseFloat(maxCe.diff_pts || 0);

            document.getElementById('dashMaxCeStrike').textContent = ceStrike !== '--' ? `${ceStrike} CE` : '--';
            document.getElementById('dashMaxCeLtp').textContent = ceLtp > 0 ? `LTP: ₹${ceLtp.toFixed(2)}` : 'LTP: --';
            document.getElementById('dashMaxCeOiCount').textContent = ceOi > 0 ? `${(ceOi / 100000).toFixed(2)}L (${ceOi.toLocaleString('en-IN')})` : '--';
            
            const ceDiffEl = document.getElementById('dashMaxCeDiff');
            if (ceDiffEl) {
                ceDiffEl.textContent = ceDiff !== 0 ? `${ceDiff >= 0 ? '+' : ''}${ceDiff.toFixed(1)} pts away` : '';
                ceDiffEl.style.color = '#991b1b';
            }

            // 3. Max PE OI Card (Support)
            const maxPe = data.max_pe || {};
            const peStrike = maxPe.strike || '--';
            const peLtp = parseFloat(maxPe.ltp || 0);
            const peOi = parseInt(maxPe.oi || 0);
            const peDiff = parseFloat(maxPe.diff_pts || 0);

            document.getElementById('dashMaxPeStrike').textContent = peStrike !== '--' ? `${peStrike} PE` : '--';
            document.getElementById('dashMaxPeLtp').textContent = peLtp > 0 ? `LTP: ₹${peLtp.toFixed(2)}` : 'LTP: --';
            document.getElementById('dashMaxPeOiCount').textContent = peOi > 0 ? `${(peOi / 100000).toFixed(2)}L (${peOi.toLocaleString('en-IN')})` : '--';
            
            const peDiffEl = document.getElementById('dashMaxPeDiff');
            if (peDiffEl) {
                peDiffEl.textContent = peDiff !== 0 ? `${peDiff >= 0 ? '+' : ''}${peDiff.toFixed(1)} pts away` : '';
                peDiffEl.style.color = '#166534';
            }

            // 4. PCR & Sentiment Card
            const pcr = parseFloat(data.pcr || 0);
            const totPe = parseInt(data.total_pe_oi || 0);
            const totCe = parseInt(data.total_ce_oi || 0);
            
            document.getElementById('dashPcrValue').textContent = pcr.toFixed(2);
            document.getElementById('dashTotalPeOiDisplay').textContent = totPe > 0 ? `${(totPe / 100000).toFixed(1)}L` : '0';
            document.getElementById('dashTotalCeOiDisplay').textContent = totCe > 0 ? `${(totCe / 100000).toFixed(1)}L` : '0';

            const pcrBadge = document.getElementById('dashPcrSentimentBadge');
            const navPcrBadge = document.getElementById('dashPcrBadge');
            if (navPcrBadge) navPcrBadge.textContent = `PCR ${pcr.toFixed(2)}`;

            if (pcrBadge) {
                pcrBadge.textContent = data.sentiment_code || 'NEUTRAL';
                if (data.sentiment_code === 'BULLISH' || data.sentiment_code === 'MILD_BULLISH') {
                    pcrBadge.style.background = '#dcfce7';
                    pcrBadge.style.color = '#166534';
                    pcrBadge.style.borderColor = '#bbf7d0';
                } else if (data.sentiment_code === 'BEARISH' || data.sentiment_code === 'MILD_BEARISH') {
                    pcrBadge.style.background = '#fee2e2';
                    pcrBadge.style.color = '#991b1b';
                    pcrBadge.style.borderColor = '#fecaca';
                } else {
                    pcrBadge.style.background = '#dbeafe';
                    pcrBadge.style.color = '#1e40af';
                    pcrBadge.style.borderColor = '#bfdbfe';
                }
            }

            // 5. Shift Tracker Card
            const ceShift = data.ce_shift;
            const peShift = data.pe_shift;
            const shiftSummaryEl = document.getElementById('dashShiftSummary');
            const shiftBadgeEl = document.getElementById('dashShiftStatusBadge');
            const lastShiftTimeEl = document.getElementById('dashLastShiftTime');
            const shiftTagEl = document.getElementById('dashShiftDirectionTag');

            if (ceShift || peShift) {
                let shiftText = '';
                if (ceShift && peShift) {
                    shiftText = `🔴 CE: ${ceShift.from_strike} → ${ceShift.to_strike} (${ceShift.direction} ${ceShift.diff_pts > 0 ? '+' : ''}${ceShift.diff_pts} pts)<br>🟢 PE: ${peShift.from_strike} → ${peShift.to_strike} (${peShift.direction} ${peShift.diff_pts > 0 ? '+' : ''}${peShift.diff_pts} pts)`;
                } else if (ceShift) {
                    const arrow = ceShift.direction === 'UP' ? '🔺' : '🔻';
                    shiftText = `${arrow} <b>Resistance Shifted ${ceShift.direction}</b> from <b>${ceShift.from_strike}</b> to <b>${ceShift.to_strike}</b> (${ceShift.diff_pts > 0 ? '+' : ''}${ceShift.diff_pts} pts) @ ${ceShift.time}`;
                } else {
                    const arrow = peShift.direction === 'UP' ? '🔺' : '🔻';
                    shiftText = `${arrow} <b>Support Shifted ${peShift.direction}</b> from <b>${peShift.from_strike}</b> to <b>${peShift.to_strike}</b> (${peShift.diff_pts > 0 ? '+' : ''}${peShift.diff_pts} pts) @ ${peShift.time}`;
                }

                shiftSummaryEl.innerHTML = shiftText;
                shiftBadgeEl.textContent = 'SHIFT DETECTED';
                shiftBadgeEl.style.background = '#fef3c7';
                shiftBadgeEl.style.color = '#b45309';
                shiftBadgeEl.style.borderColor = '#fde68a';

                const latestShift = ceShift || peShift;
                lastShiftTimeEl.textContent = `Shifted @ ${latestShift.time}`;
                shiftTagEl.textContent = latestShift.direction === 'UP' ? 'Bullish Shift ↗️' : 'Bearish Shift ↘️';
                shiftTagEl.style.color = latestShift.direction === 'UP' ? '#166534' : '#991b1b';
            } else {
                shiftSummaryEl.innerHTML = `<span style="color: var(--text-muted);">Max OI is firmly anchored at <b>${ceStrike} CE</b> &amp; <b>${peStrike} PE</b>. No shift detected.</span>`;
                shiftBadgeEl.textContent = 'STABLE BASE';
                shiftBadgeEl.style.background = '#f1f5f9';
                shiftBadgeEl.style.color = '#475569';
                shiftBadgeEl.style.borderColor = '#e2e8f0';
                lastShiftTimeEl.textContent = `Checked: ${data.last_updated ? data.last_updated.split(' ')[1] : 'Just now'}`;
                shiftTagEl.textContent = 'No Shift';
                shiftTagEl.style.color = 'var(--text-muted)';
            }

            // 6. Shift History Log List
            const historyContainer = document.getElementById('dashShiftHistoryList');
            const shifts = data.shifts_history || [];
            if (shifts.length > 0) {
                historyContainer.innerHTML = shifts.map(sh => {
                    const isCe = sh.type === 'CE_RESISTANCE_SHIFT' || sh.type?.includes('CE');
                    const color = isCe ? '#991b1b' : '#166534';
                    const bg = isCe ? '#fef2f2' : '#f0fdf4';
                    const border = isCe ? '#fecaca' : '#bbf7d0';
                    const arrow = sh.direction === 'UP' ? '🔺' : '🔻';
                    return `
                    <div style="background: ${bg}; border: 1px solid ${border}; border-radius: 6px; padding: 8px 12px; font-size: 11px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                            <span style="font-weight: 800; color: ${color};">${arrow} ${isCe ? 'Call (CE) Resistance' : 'Put (PE) Support'} Shifted ${sh.direction}</span>
                            <span style="font-family: monospace; color: var(--text-muted); font-size: 10px;">${sh.date || ''} ${sh.time || ''}</span>
                        </div>
                        <div style="color: var(--text-primary);">
                            <b>${sh.from_strike}</b> ➔ <b style="color: ${color};">${sh.to_strike}</b> (${sh.diff_pts > 0 ? '+' : ''}${sh.diff_pts} pts)
                        </div>
                        <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">
                            ${sh.interpretation || ''}
                        </div>
                    </div>`;
                }).join('');
            } else {
                historyContainer.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 24px;">
                        ✅ No strike shifts recorded yet for this session.
                    </div>`;
            }

            // 7. Top 5 Strikes with Max Change in OI
            const topCeChangeContainer = document.getElementById('dashTopCeOiChangeList');
            const topPeChangeContainer = document.getElementById('dashTopPeOiChangeList');
            const topCeChange = data.top_ce_oi_change || [];
            const topPeChange = data.top_pe_oi_change || [];

            if (topCeChangeContainer) {
                topCeChangeContainer.innerHTML = topCeChange.length > 0 ? topCeChange.map((s, i) => {
                    const chg = s.ce_oi_change || 0;
                    const chgSign = chg > 0 ? '+' : '';
                    const chgLakhs = (chg / 100000).toFixed(2);
                    return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; background: ${i === 0 ? '#fee2e2' : '#f8fafc'}; border-radius: 4px; border: 1px solid ${i === 0 ? '#fca5a5' : '#e2e8f0'};">
                        <span style="font-weight: 800; color: #991b1b;">#${i+1} ${s.strike} CE</span>
                        <div style="text-align: right;">
                            <span style="font-weight: 800; color: ${chg >= 0 ? '#dc2626' : '#16a34a'};">${chgSign}${chgLakhs}L</span>
                            <span style="color: var(--text-muted); font-size: 10px; display: block;">₹${s.ce_ltp.toFixed(1)}</span>
                        </div>
                    </div>`;
                }).join('') : '<div style="color: var(--text-muted); font-size: 10px; padding: 4px;">No change data</div>';
            }

            if (topPeChangeContainer) {
                topPeChangeContainer.innerHTML = topPeChange.length > 0 ? topPeChange.map((s, i) => {
                    const chg = s.pe_oi_change || 0;
                    const chgSign = chg > 0 ? '+' : '';
                    const chgLakhs = (chg / 100000).toFixed(2);
                    return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; background: ${i === 0 ? '#dcfce7' : '#f8fafc'}; border-radius: 4px; border: 1px solid ${i === 0 ? '#86efac' : '#e2e8f0'};">
                        <span style="font-weight: 800; color: #166534;">#${i+1} ${s.strike} PE</span>
                        <div style="text-align: right;">
                            <span style="font-weight: 800; color: ${chg >= 0 ? '#16a34a' : '#dc2626'};">${chgSign}${chgLakhs}L</span>
                            <span style="color: var(--text-muted); font-size: 10px; display: block;">₹${s.pe_ltp.toFixed(1)}</span>
                        </div>
                    </div>`;
                }).join('') : '<div style="color: var(--text-muted); font-size: 10px; padding: 4px;">No change data</div>';
            }

            // 8. Top 5 Highest Total OI Strikes Quick List
            const topCeContainer = document.getElementById('dashTopCeList');
            const topPeContainer = document.getElementById('dashTopPeList');
            const topCe = data.top_ce_strikes || [];
            const topPe = data.top_pe_strikes || [];

            if (topCeContainer) {
                topCeContainer.innerHTML = topCe.map((s, i) => `
                    <div style="display: flex; justify-content: space-between; padding: 3px 6px; background: ${i === 0 ? '#fee2e2' : '#f8fafc'}; border-radius: 4px; border: 1px solid ${i === 0 ? '#fca5a5' : '#e2e8f0'};">
                        <span style="font-weight: 800; color: #991b1b;">#${i+1} ${s.strike} CE</span>
                        <span>${(s.ce_oi / 100000).toFixed(2)}L <span style="color: var(--text-muted); font-size: 10px;">(₹${s.ce_ltp.toFixed(1)})</span></span>
                    </div>
                `).join('');
            }

            if (topPeContainer) {
                topPeContainer.innerHTML = topPe.map((s, i) => `
                    <div style="display: flex; justify-content: space-between; padding: 3px 6px; background: ${i === 0 ? '#dcfce7' : '#f8fafc'}; border-radius: 4px; border: 1px solid ${i === 0 ? '#86efac' : '#e2e8f0'};">
                        <span style="font-weight: 800; color: #166534;">#${i+1} ${s.strike} PE</span>
                        <span>${(s.pe_oi / 100000).toFixed(2)}L <span style="color: var(--text-muted); font-size: 10px;">(₹${s.pe_ltp.toFixed(1)})</span></span>
                    </div>
                `).join('');
            }

            // 9. Open Interest Dual Bar Chart & Table
            const tableBody = document.getElementById('dashOiTableBody');
            const strikes = data.strikes_table || [];

            if (strikes.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No strike data found.</td></tr>`;
                return;
            }

            // Find maximum OI across all strikes for proportional bar widths
            const maxOverallOi = Math.max(...strikes.map(s => Math.max(s.ce_oi || 0, s.pe_oi || 0)), 1);

            tableBody.innerHTML = strikes.map(s => {
                const isMaxCe = s.strike === maxCe.strike;
                const isMaxPe = s.strike === maxPe.strike;
                const isAtmMagnitude = spotPrice > 0 && Math.abs(s.strike - spotPrice) <= 50;

                const ceBarPct = Math.min(100, Math.round((s.ce_oi / maxOverallOi) * 100));
                const peBarPct = Math.min(100, Math.round((s.pe_oi / maxOverallOi) * 100));

                const rowBg = isAtmMagnitude ? '#fefce8' : (isMaxCe && isMaxPe ? '#f3e8ff' : (isMaxCe ? '#fff5f5' : (isMaxPe ? '#f0fdf4' : 'transparent')));

                return `
                <tr style="background: ${rowBg}; border-bottom: 1px solid var(--border-color);">
                    <!-- CE OI Bar + Value (Align Right) -->
                    <td style="text-align: right; padding: 6px 10px; position: relative;">
                        <div style="position: absolute; right: 0; top: 15%; bottom: 15%; width: ${ceBarPct}%; background: rgba(239, 68, 68, 0.22); border-radius: 3px 0 0 3px; z-index: 1;"></div>
                        <div style="position: relative; z-index: 2; font-family: 'JetBrains Mono', monospace; font-weight: ${isMaxCe ? '900' : '600'}; color: ${isMaxCe ? '#991b1b' : 'inherit'};">
                            ${isMaxCe ? '🔴 ' : ''}${(s.ce_oi / 100000).toFixed(2)}L
                        </div>
                    </td>

                    <!-- CE LTP -->
                    <td style="text-align: right; font-family: monospace; color: var(--text-secondary); padding: 6px 8px;">
                        ₹${s.ce_ltp > 0 ? s.ce_ltp.toFixed(1) : '--'}
                    </td>

                    <!-- Strike (Center) -->
                    <td style="text-align: center; font-weight: 900; font-family: 'JetBrains Mono', monospace; font-size: 12px; background: ${isAtmMagnitude ? '#fde047' : '#f8fafc'}; color: ${isAtmMagnitude ? '#713f12' : 'var(--text-primary)'}; padding: 6px 4px; border-left: 1px solid var(--border-color); border-right: 1px solid var(--border-color);">
                        ${s.strike}
                        ${isAtmMagnitude ? '<span style="font-size: 9px; font-weight: 800; display: block; color: #854d0e;">ATM</span>' : ''}
                    </td>

                    <!-- PE LTP -->
                    <td style="text-align: left; font-family: monospace; color: var(--text-secondary); padding: 6px 8px;">
                        ₹${s.pe_ltp > 0 ? s.pe_ltp.toFixed(1) : '--'}
                    </td>

                    <!-- PE OI Bar + Value (Align Left) -->
                    <td style="text-align: left; padding: 6px 10px; position: relative;">
                        <div style="position: absolute; left: 0; top: 15%; bottom: 15%; width: ${peBarPct}%; background: rgba(34, 197, 94, 0.22); border-radius: 0 3px 3px 0; z-index: 1;"></div>
                        <div style="position: relative; z-index: 2; font-family: 'JetBrains Mono', monospace; font-weight: ${isMaxPe ? '900' : '600'}; color: ${isMaxPe ? '#166534' : 'inherit'};">
                            ${(s.pe_oi / 100000).toFixed(2)}L${isMaxPe ? ' 🟢' : ''}
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }

        // ═══════════════════════════════════════════════════════════════
        // VIEW MANAGEMENT
        // ═══════════════════════════════════════════════════════════════

        function showDashboard(userName) {
            document.getElementById('loginView').style.display = 'none';
            document.getElementById('consoleView').style.display = 'block';
            document.getElementById('btnLogout').style.display = 'inline-flex';
            
            // Switch to DASHBOARD (Tab 0) by default upon login
            switchMainTab('tabDashboard');

            loadExpiries();
            loadLotSizes().then(() => {
                onPosIndexChange();
                onStraddleIndexChange();
            });
            onDashIndexChange();
            onDashIntervalChange();
            fetchAndRenderStrategies();
            fetchPosStrangleStatus(true);
            fetchStraddleStatus(true);
            fetchCommodityStatus(true);
            fetchTvStatus(true);
            fetchIntradayPnlSummary();
            fetchCommodityPnlSummary();
            loadSavedMtmChartData();
            startLiveMonitors();
        }

        function showLogin() {
            document.getElementById('loginView').style.display = 'flex';
            document.getElementById('consoleView').style.display = 'none';
            document.getElementById('btnLogout').style.display = 'none';
        }

        // ═══════════════════════════════════════════════════════════════
        // TAB SWITCHING
        // ═══════════════════════════════════════════════════════════════

        function switchMainTab(tabId, btn) {
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

            const targetPane = document.getElementById(tabId);
            if (targetPane) targetPane.classList.add('active');
            if (btn) {
                btn.classList.add('active');
            } else {
                const matchingBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
                if (matchingBtn) matchingBtn.classList.add('active');
            }

            // Immediately refresh strategies and state for the active tab
            if (tabId === 'tabDashboard') {
                fetchDashboardOiAnalysis();
            } else if (tabId === 'tabConfigLogs') {
                fetchAndRenderStrategies();
            } else if (tabId === 'tabPosStrangle') {
                fetchPosStrangleStatus(true);
            } else if (tabId === 'tabStraddleTotalSl') {
                fetchStraddleStatus(true);
            } else if (tabId === 'tabCommodity') {
                fetchCommodityStatus(true);
                fetchCommodityPnlSummary();
            } else if (tabId === 'tabTradingView') {
                fetchTvStatus(true);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // LIVE EXCHANGE CLOCK & STATUS POLLING (1s Logs, 5s MTM & Orders)
        // ═══════════════════════════════════════════════════════════════

        let lastMtmPollTime = 0;
        let liveMonitorsStarted = false;

        function startLiveMonitors() {
            if (liveMonitorsStarted) return;
            liveMonitorsStarted = true;

            // 1-second exchange clock
            setInterval(() => {
                const now = new Date();
                document.getElementById('exchangeClock').textContent = now.toLocaleTimeString('en-IN', { hour12: false });
            }, 1000);

            // 3-second fast strategy logs & prices monitor (Intraday multi-strategy)
            setInterval(async () => {
                if (document.getElementById('consoleView').style.display !== 'block') return;
                try {
                    const data = await api('/api/strategy/logs');

                    const wStatus = document.getElementById('websocketStatus');
                    const wText = document.getElementById('websocketText');
                    wStatus.className = `status-pill ${data.ticker_status.toLowerCase()}`;
                    wText.textContent = `WS ${data.ticker_status}`;

                    document.getElementById('overlayCashLtp').textContent = data.cash_ltp > 0 ? `₹${data.cash_ltp.toFixed(2)}` : '--';
                    document.getElementById('overlayCashSymbol').textContent = data.cash_symbol || '--';

                    document.getElementById('overlayFutureLtp').textContent = data.future_ltp > 0 ? `₹${data.future_ltp.toFixed(2)}` : '--';
                    document.getElementById('overlayFutureSymbol').textContent = data.future_symbol || '--';

                    document.getElementById('overlayCeLtp').textContent = data.selected_ce_ltp > 0 ? `₹${data.selected_ce_ltp.toFixed(2)}` : '--';
                    document.getElementById('overlayCeStrike').textContent = data.selected_ce || '--';
                    document.getElementById('overlayPeLtp').textContent = data.selected_pe_ltp > 0 ? `₹${data.selected_pe_ltp.toFixed(2)}` : '--';
                    document.getElementById('overlayPeStrike').textContent = data.selected_pe || '--';

                    if (data.strategies) {
                        loadedStrategies = data.strategies;
                        renderStrategies(data.strategies);
                    }

                    const term = document.getElementById('logsTerminal');
                    if (data.logs && data.logs.length > 0) {
                        term.innerHTML = data.logs.map(l => `<div class="log-line">${l}</div>`).join('');
                        term.scrollTop = term.scrollHeight;
                    }
                } catch (e) {
                    // handle poll error
                }
            }, 3000);

            // 3-second Positional Strangle monitor
            setInterval(() => {
                if (document.getElementById('consoleView').style.display === 'block') {
                    fetchPosStrangleStatus();
                }
            }, 3000);

            // 3-second Straddle Total SL monitor
            setInterval(() => {
                if (document.getElementById('consoleView').style.display === 'block') {
                    fetchStraddleStatus();
                }
            }, 3000);

            // 3-second MCX Commodity monitor
            setInterval(() => {
                if (document.getElementById('consoleView').style.display === 'block') {
                    fetchCommodityStatus();
                }
            }, 3000);

            // 3-second TradingView Strategies & Alerts monitor
            setInterval(() => {
                if (document.getElementById('consoleView').style.display === 'block') {
                    fetchTvStatus();
                }
            }, 3000);

            // 3-second MTM, Positions, and Order Book Polling
            refreshOrdersAndPositions();
            setInterval(() => {
                if (document.getElementById('consoleView').style.display === 'block') {
                    refreshOrdersAndPositions();
                }
            }, 3000);
        }

        // ═══════════════════════════════════════════════════════════════
        // MTM & ORDER BOOK DATA FETCHING (3-SEC POLLING)
        // ═══════════════════════════════════════════════════════════════

        async function refreshOrdersAndPositions(showToast = false) {
            try {
                const [ordersRes, posRes, posStratRes, intraSummaryRes] = await Promise.all([
                    api('/api/orders').catch(() => ({ orders: [] })),
                    api('/api/positions').catch(() => ({ positions: {} })),
                    api('/api/pos_strangle/status').catch(() => ({ strategies: [] })),
                    api('/api/intraday_pnl/summary').catch(() => ({ status: 'error' }))
                ]);

                if (intraSummaryRes && intraSummaryRes.status === 'ok') {
                    intraPnlSummaryData = intraSummaryRes;
                    renderIntraHistoryTable(intraSummaryRes.history || []);
                    const badge = document.getElementById('intraJournalDaysBadge');
                    if (badge) badge.textContent = `${intraSummaryRes.records_count || 0} Day${intraSummaryRes.records_count === 1 ? '' : 's'} in Journal`;
                }

                if (posStratRes && posStratRes.strategies) {
                    loadedPosStrategies = posStratRes.strategies;
                    renderPosInstrumentGroups(loadedPosStrategies);
                    if (posStratRes.logs) renderPosLogs(posStratRes.logs);
                }

                const orders = (ordersRes && ordersRes.orders) || [];
                const netPositions = (posRes && posRes.positions && posRes.positions.net) || [];
                window.latestNetPositions = netPositions;
                const dayPositions = (posRes && posRes.positions && posRes.positions.day) || [];

                renderMtmSummary(netPositions, dayPositions, orders);
                renderOrderBook(orders);
                renderPositionsTable(netPositions);

                if (showToast) toast('Orders and MTM updated');
            } catch (e) {
                console.error('Error refreshing orders/positions:', e);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // MTM CHART MANAGEMENT (Chart.js) — 09:15 AM to 03:40 PM Timeline
        // ═══════════════════════════════════════════════════════════════

        let mtmChart = null;
        let mtmHistory = []; // { time: '09:20:00', total: 150, intraday: 100, pos: 50 }
        const CHART_START_TIME = "09:15:00";
        const CHART_END_TIME = "15:40:00";

        function initMtmChart() {
            const ctx = document.getElementById('mtmChartCanvas');
            if (!ctx || typeof Chart === 'undefined') return;

            mtmChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: '⚡ Intraday Strategy MTM (₹)',
                            data: [],
                            borderColor: '#2563eb',
                            backgroundColor: 'rgba(37, 99, 235, 0.08)',
                            borderWidth: 2.5,
                            fill: true,
                            tension: 0.25,
                            pointRadius: 0,
                            pointHoverRadius: 5
                        },
                        {
                            label: '🧭 Positional Strategy MTM (₹)',
                            data: [],
                            borderColor: '#7c3aed',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            borderDash: [5, 4],
                            fill: false,
                            tension: 0.25,
                            pointRadius: 0,
                            pointHoverRadius: 5
                        },
                        {
                            label: '📊 Combined Total MTM (₹)',
                            data: [],
                            borderColor: '#059669',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            fill: false,
                            tension: 0.25,
                            pointRadius: 0,
                            pointHoverRadius: 5
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 200 },
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: { family: 'Inter', weight: 600, size: 12 },
                                color: '#212925',
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const val = context.parsed.y || 0;
                                    const dsName = context.dataset.label || '';
                                    return ` ${dsName}: ${val >= 0 ? '+₹' : '-₹'}${Math.abs(val).toFixed(2)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(204, 213, 208, 0.35)' },
                            title: {
                                display: true,
                                text: 'Market Hours (09:15 AM – 03:40 PM)',
                                font: { family: 'Inter', size: 11, weight: 600 },
                                color: '#728078'
                            },
                            ticks: {
                                font: { family: 'JetBrains Mono', size: 10 },
                                maxTicksLimit: 14,
                                color: '#728078'
                            }
                        },
                        y: {
                            grid: { color: 'rgba(204, 213, 208, 0.35)' },
                            ticks: {
                                font: { family: 'JetBrains Mono', size: 11 },
                                color: '#728078',
                                callback: function (value) {
                                    return `₹${value}`;
                                }
                            }
                        }
                    }
                }
            });

            toggleMtmCurveVisibility();
        }

        function toggleMtmCurveVisibility() {
            if (!mtmChart) return;
            const showIntra = document.getElementById('toggleIntraCurve') ? document.getElementById('toggleIntraCurve').checked : true;
            const showPos = document.getElementById('togglePosCurve') ? document.getElementById('togglePosCurve').checked : true;
            const showCombined = document.getElementById('toggleCombinedCurve') ? document.getElementById('toggleCombinedCurve').checked : true;

            mtmChart.setDatasetVisibility(0, showIntra);
            mtmChart.setDatasetVisibility(1, showPos);
            mtmChart.setDatasetVisibility(2, showCombined);
            mtmChart.update();
        }

        let _loadedSessionDate = "";
        let _isPreviousDaySession = false;

        async function loadSavedMtmChartData() {
            try {
                const res = await api('/api/mtm_chart/data');
                if (res && res.points && res.points.length > 0) {
                    mtmHistory = res.points;
                    _loadedSessionDate = res.date || "";
                    _isPreviousDaySession = Boolean(res.is_previous_day);

                    if (!mtmChart) initMtmChart();
                    renderMtmChartFromHistory();

                    const statusBadge = document.getElementById('chartStatusBadge');
                    if (statusBadge) {
                        if (_isPreviousDaySession) {
                            statusBadge.textContent = `📅 Showing Last Trading Session (${_loadedSessionDate})`;
                            statusBadge.style.background = '#fef3c7';
                            statusBadge.style.color = '#92400e';
                            statusBadge.style.borderColor = '#fde68a';
                        } else {
                            statusBadge.textContent = `📊 Today's Session (${_loadedSessionDate})`;
                            statusBadge.style.background = '#e0f2fe';
                            statusBadge.style.color = '#0369a1';
                            statusBadge.style.borderColor = '#bae6fd';
                        }
                    }
                }
            } catch (e) { }
        }

        function renderMtmChartFromHistory() {
            if (!mtmChart) initMtmChart();
            if (!mtmChart) return;

            let labels = mtmHistory.map(d => d.time);
            let intraData = mtmHistory.map(d => d.intraday);
            let posData = mtmHistory.map(d => d.pos);
            let totalData = mtmHistory.map(d => d.total);

            if (labels.length > 0 && labels[0] > CHART_START_TIME && !labels.includes(CHART_START_TIME)) {
                labels = [CHART_START_TIME, ...labels];
                intraData = [0, ...intraData];
                posData = [0, ...posData];
                totalData = [0, ...totalData];
            }

            mtmChart.data.labels = labels;
            mtmChart.data.datasets[0].data = intraData;
            mtmChart.data.datasets[1].data = posData;
            mtmChart.data.datasets[2].data = totalData;

            const lastIntra = intraData.length > 0 ? intraData[intraData.length - 1] : 0;
            const isPositive = lastIntra >= 0;
            mtmChart.data.datasets[0].borderColor = isPositive ? '#2563eb' : '#cb534e';
            mtmChart.data.datasets[0].backgroundColor = isPositive ? 'rgba(37, 99, 235, 0.08)' : 'rgba(203, 83, 78, 0.08)';

            mtmChart.update();

            const badge = document.getElementById('chartPointCountBadge');
            const datePrefix = _isPreviousDaySession ? `[${_loadedSessionDate}] ` : '';
            if (badge) badge.textContent = `${datePrefix}${mtmHistory.length} Data Points (${labels[labels.length - 1] || '--'})`;
        }

        let _lastSavedPointTime = 0;

        function updateMtmChart(totalPnl, intradayPnl = 0, posPnl = 0, intraOpenCount = 0, posOpenCount = 0) {
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            const timeLabel = now.toLocaleTimeString('en-IN', { hour12: false });
            const isMarketHours = (timeLabel >= "09:15:00" && timeLabel <= "15:30:00");
            const hasActiveIntra = (intraOpenCount > 0);
            const hasActivePos = (posOpenCount > 0);
            const hasAnyActiveTrade = hasActiveIntra || hasActivePos || (Math.abs(intradayPnl) > 0.01) || (Math.abs(posPnl) > 0.01);

            const statusBadge = document.getElementById('chartStatusBadge');

            // 🌅 Automatic Refresh When New Trading Session Opens (>= 09:15 AM on new date)
            if (isMarketHours && _isPreviousDaySession) {
                mtmHistory = [];
                _isPreviousDaySession = false;
                _loadedSessionDate = todayStr;
            }

            // 🛑 Smart Stopping Condition: If market closed or holiday
            if (!isMarketHours) {
                if (statusBadge) {
                    if (_isPreviousDaySession || mtmHistory.length > 0) {
                        const dateLabel = _loadedSessionDate || todayStr;
                        statusBadge.textContent = `📅 Market Closed (Retaining Session: ${dateLabel})`;
                        statusBadge.style.background = '#fef3c7';
                        statusBadge.style.color = '#92400e';
                        statusBadge.style.borderColor = '#fde68a';
                    } else {
                        statusBadge.textContent = '⏸️ Market Closed (09:15 - 15:30)';
                        statusBadge.style.background = '#f1f5f9';
                        statusBadge.style.color = '#64748b';
                        statusBadge.style.borderColor = '#cbd5e1';
                    }
                }
                return;
            }

            // If market is open but idle with no positions and 0 PnL
            if (!hasAnyActiveTrade && mtmHistory.length > 0 && Math.abs(intradayPnl) < 0.01) {
                if (statusBadge) {
                    statusBadge.textContent = '⏸️ Idle (No Active Positions)';
                    statusBadge.style.background = '#f8fafc';
                    statusBadge.style.color = '#94a3b8';
                    statusBadge.style.borderColor = '#e2e8f0';
                }
                return;
            }

            if (statusBadge) {
                const actDesc = hasActiveIntra ? 'Intraday Active' : (hasActivePos ? 'Positional Active' : 'Live');
                statusBadge.textContent = `🟢 Live Sampling (${actDesc})`;
                statusBadge.style.background = '#dcfce7';
                statusBadge.style.color = '#15803d';
                statusBadge.style.borderColor = '#bbf7d0';
            }

            // Don't record duplicate within same second
            if (mtmHistory.length > 0 && mtmHistory[mtmHistory.length - 1].time === timeLabel) {
                return;
            }

            const newPoint = {
                time: timeLabel,
                intraday: roundTo2(intradayPnl),
                pos: roundTo2(posPnl),
                total: roundTo2(totalPnl)
            };

            mtmHistory.push(newPoint);
            renderMtmChartFromHistory();

            // Debounced save to server file (every 10 seconds)
            const nowTs = Date.now();
            if (nowTs - _lastSavedPointTime > 10000) {
                _lastSavedPointTime = nowTs;
                api('/api/mtm_chart/data', 'POST', { point: newPoint }).catch(() => { });
            }
        }

        function roundTo2(val) {
            return Math.round((parseFloat(val) || 0) * 100) / 100;
        }

        async function clearMtmChartData() {
            mtmHistory = [];
            try {
                await api('/api/mtm_chart/clear', 'POST');
            } catch (e) { }

            if (mtmChart) {
                mtmChart.data.labels = [CHART_START_TIME];
                mtmChart.data.datasets[0].data = [0];
                mtmChart.data.datasets[1].data = [0];
                mtmChart.data.datasets[2].data = [0];
                mtmChart.update();
            }
            const badge = document.getElementById('chartPointCountBadge');
            if (badge) badge.textContent = `0 Data Points (09:15 - 15:40)`;
            toast('MTM Chart Reset');
        }

        function formatPnl(val) {
            const num = parseFloat(val) || 0;
            const prefix = num >= 0 ? '+₹' : '-₹';
            return `${prefix}${Math.abs(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }

        function getPnlClass(val) {
            const num = parseFloat(val) || 0;
            if (num > 0) return 'pnl-positive';
            if (num < 0) return 'pnl-negative';
            return 'pnl-neutral';
        }

        function renderMtmSummary(netPositions, dayPositions, orders) {
            const intradaySymbols = new Set();
            const intradayTags = new Set();
            loadedStrategies.forEach(s => {
                if (s.run_tag) intradayTags.add(s.run_tag);
                if (s.selected_ce) intradaySymbols.add(s.selected_ce);
                if (s.selected_pe) intradaySymbols.add(s.selected_pe);
                if (s.orders) {
                    if (s.orders.CE && s.orders.CE.symbol) intradaySymbols.add(s.orders.CE.symbol);
                    if (s.orders.PE && s.orders.PE.symbol) intradaySymbols.add(s.orders.PE.symbol);
                }
            });

            const posSymbols = new Set();
            const posTags = new Set();
            loadedPosStrategies.forEach(s => {
                if (s.run_tag) posTags.add(s.run_tag);
                if (s.selected_ce) posSymbols.add(s.selected_ce);
                if (s.selected_pe) posSymbols.add(s.selected_pe);
                if (s.orders) {
                    if (s.orders.CE && s.orders.CE.symbol) posSymbols.add(s.orders.CE.symbol);
                    if (s.orders.PE && s.orders.PE.symbol) posSymbols.add(s.orders.PE.symbol);
                }
            });
            loadedStraddleStrategies.forEach(s => {
                if (s.run_tag) posTags.add(s.run_tag);
                if (s.selected_ce) posSymbols.add(s.selected_ce);
                if (s.selected_pe) posSymbols.add(s.selected_pe);
                if (s.orders) {
                    if (s.orders.CE && s.orders.CE.symbol) posSymbols.add(s.orders.CE.symbol);
                    if (s.orders.PE && s.orders.PE.symbol) posSymbols.add(s.orders.PE.symbol);
                }
            });

            orders.forEach(o => {
                const tag = (o.tag || '').trim();
                const sym = (o.tradingsymbol || '').trim();
                if (tag.startsWith('ps_') || tag.startsWith('std_') || posTags.has(tag)) {
                    if (sym) posSymbols.add(sym);
                } else if (tag.startsWith('s') || tag.startsWith('straddle') || intradayTags.has(tag)) {
                    if (sym) intradaySymbols.add(sym);
                }
            });

            const allPositions = netPositions.length > 0 ? netPositions : dayPositions;

            let intraUnrealized = 0, intraRealized = 0, intraTotalPnl = 0, intraOpenCount = 0;
            let posUnrealized = 0, posRealized = 0, posTotalPnl = 0, posOpenCount = 0;

            allPositions.forEach(p => {
                const sym = (p.tradingsymbol || '').trim();
                const prod = (p.product || '').toUpperCase();
                const pnl = parseFloat(p.pnl || p.m2m || 0);
                const unrealized = parseFloat(p.unrealised || p.unrealized || 0);
                const realized = parseFloat(p.realised || p.realized || 0);
                const qty = parseInt(p.quantity) || 0;

                // Strict filtering: Only count symbols actually configured or executed by pos_strngl.py
                const isPos = posSymbols.has(sym);
                const isIntra = intradaySymbols.has(sym);

                if (isPos && !isIntra) {
                    posTotalPnl += pnl;
                    posUnrealized += unrealized;
                    posRealized += realized;
                    if (qty !== 0) posOpenCount++;
                } else if (isIntra) {
                    intraTotalPnl += pnl;
                    intraUnrealized += unrealized;
                    intraRealized += realized;
                    if (qty !== 0) intraOpenCount++;
                }
            });

            // Combine totals
            const combinedTotalPnl = intraTotalPnl + posTotalPnl;
            const combinedUnrealized = intraUnrealized + posUnrealized;
            const combinedRealized = intraRealized + posRealized;
            const totalOpenCount = intraOpenCount + posOpenCount;

            // 1. Combined Box
            const totalMtmEl = document.getElementById('totalMtmVal');
            if (totalMtmEl) {
                totalMtmEl.textContent = formatPnl(combinedTotalPnl);
                totalMtmEl.className = `mtm-value ${getPnlClass(combinedTotalPnl)}`;
            }

            // 2. Intraday Box
            const pastDaysSettled = parseFloat(intraPnlSummaryData.cumulative_recorded_pnl || 0) - parseFloat(intraPnlSummaryData.today_recorded_pnl || 0);
            const totalCumulativeIntra = pastDaysSettled + intraTotalPnl;

            const intraMtmEl = document.getElementById('intradayMtmVal');
            if (intraMtmEl) {
                intraMtmEl.textContent = formatPnl(intraTotalPnl);
                intraMtmEl.className = `mtm-value ${getPnlClass(intraTotalPnl)}`;
            }
            const intraSubEl = document.getElementById('intradaySubtext');
            if (intraSubEl) {
                intraSubEl.textContent = `Cumul: ${formatPnl(totalCumulativeIntra)} | Unreal: ${formatPnl(intraUnrealized)}`;
            }

            // Update Intraday Tab Stats Card
            const intraTodayDisplayEl = document.getElementById('intraTodayPnlDisplay');
            if (intraTodayDisplayEl) {
                intraTodayDisplayEl.textContent = formatPnl(intraTotalPnl);
                intraTodayDisplayEl.className = `${getPnlClass(intraTotalPnl)}`;
            }
            const intraCumDisplayEl = document.getElementById('intraCumulativePnlDisplay');
            if (intraCumDisplayEl) {
                intraCumDisplayEl.textContent = formatPnl(totalCumulativeIntra);
                intraCumDisplayEl.className = `${getPnlClass(totalCumulativeIntra)}`;
            }
            const intraCumDaysEl = document.getElementById('intraCumulativeDaysText');
            if (intraCumDaysEl) {
                intraCumDaysEl.textContent = `Past Settled: ${formatPnl(pastDaysSettled)} + Today: ${formatPnl(intraTotalPnl)}`;
            }

            // 3. Positional Box
            const posMtmEl = document.getElementById('posMtmVal');
            if (posMtmEl) {
                posMtmEl.textContent = formatPnl(posTotalPnl);
                posMtmEl.className = `mtm-value ${getPnlClass(posTotalPnl)}`;
            }
            const posSubEl = document.getElementById('posSubtext');
            if (posSubEl) {
                posSubEl.textContent = `Unreal: ${formatPnl(posUnrealized)} | Real: ${formatPnl(posRealized)} (${posOpenCount} Open)`;
            }

            // 4. Realized & Unrealized
            const realEl = document.getElementById('realizedPnlVal');
            if (realEl) {
                realEl.textContent = formatPnl(combinedRealized);
                realEl.className = `mtm-value ${getPnlClass(combinedRealized)}`;
            }
            const unrealEl = document.getElementById('unrealizedPnlVal');
            if (unrealEl) {
                unrealEl.textContent = `Unrealized: ${formatPnl(combinedUnrealized)}`;
            }

            const posBadge = document.getElementById('positionCountBadge');
            if (posBadge) posBadge.textContent = totalOpenCount;

            const now = new Date();
            const lastUpEl = document.getElementById('mtmLastUpdated');
            if (lastUpEl) lastUpEl.textContent = `Sync: ${now.toLocaleTimeString('en-IN')} (⚡${formatPnl(intraTotalPnl)} | 🧭${formatPnl(posTotalPnl)})`;

            // Plot into Multi-Curve Strategy MTM Chart (09:15 to 15:40)
            updateMtmChart(combinedTotalPnl, intraTotalPnl, posTotalPnl, intraOpenCount, posOpenCount);

            // Count pending SL orders and breakeven orders for both engines
            let intraPendingSl = 0, posPendingSl = 0, breakevenCount = 0;

            loadedStrategies.forEach(s => {
                if (s.orders) {
                    ['CE', 'PE'].forEach(leg => {
                        if (s.orders[leg] && s.orders[leg].sl_modified_to_be) breakevenCount++;
                    });
                }
            });
            loadedPosStrategies.forEach(s => {
                if (s.orders) {
                    ['CE', 'PE'].forEach(leg => {
                        if (s.orders[leg] && s.orders[leg].sl_modified_to_be) breakevenCount++;
                    });
                }
            });

            orders.forEach(o => {
                const type = (o.order_type || '').toUpperCase();
                const status = (o.status || '').toUpperCase();
                const tag = (o.tag || '').trim();
                const sym = (o.tradingsymbol || '').trim();
                const isSl = (type === 'SL' || type === 'SL-M') && (status === 'OPEN' || status === 'TRIGGER PENDING');
                if (isSl) {
                    if (tag.startsWith('ps_') || posTags.has(tag) || posSymbols.has(sym)) {
                        posPendingSl++;
                    } else {
                        intraPendingSl++;
                    }
                }
            });

            const totalPendingSl = intraPendingSl + posPendingSl;
            const slEl = document.getElementById('activeSlOrdersVal');
            if (slEl) slEl.textContent = `${totalPendingSl} Pending SL (⚡${intraPendingSl} | 🧭${posPendingSl})`;
            const beEl = document.getElementById('breakevenCounterVal');
            if (beEl) beEl.textContent = `${breakevenCount} Leg${breakevenCount === 1 ? '' : 's'} at Breakeven`;
        }

        let intraPnlSummaryData = {
            today_recorded_pnl: 0.0,
            cumulative_recorded_pnl: 0.0,
            records_count: 0,
            history: []
        };

        async function fetchIntradayPnlSummary() {
            try {
                const res = await api('/api/intraday_pnl/summary');
                if (res.status === 'ok') {
                    intraPnlSummaryData = res;
                    renderIntraHistoryTable(res.history || []);
                    const badge = document.getElementById('intraJournalDaysBadge');
                    if (badge) badge.textContent = `${res.records_count || 0} Day${res.records_count === 1 ? '' : 's'} in Journal`;
                }
            } catch (e) {
                // Polling error
            }
        }

        function toggleIntraHistoryTable() {
            const container = document.getElementById('intraHistoryContainer');
            if (container) {
                const isHidden = container.style.display === 'none';
                const willShow = isHidden;
                container.style.display = willShow ? 'block' : 'none';
                setWindowCollapseState('intraHistoryContainer', !willShow);
                if (willShow) fetchIntradayPnlSummary();
            }
        }

        function renderIntraHistoryTable(records) {
            const tbody = document.getElementById('intraHistoryBody');
            if (!tbody) return;
            if (!records || records.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="12" style="text-align: center; color: var(--text-muted); padding: 16px;">
                            No trade records in intraday_PnL.csv yet. Records are automatically added upon trade execution, SL hit, and exit.
                        </td>
                    </tr>`;
                return;
            }

            tbody.innerHTML = records.map(r => {
                const dayPnl = parseFloat(r.Day_PnL !== undefined ? r.Day_PnL : (r.Day_Total_PnL || 0));
                const cumPnl = parseFloat(r.Cumulative_PnL || 0);
                const sname = r.Strategy_Name || 'Intraday Strategy';
                const inst = r.Instrument || '--';
                const lot = r.Lot_Size || '--';
                const leg = r.Leg || (r.CE_Symbol && r.CE_Symbol !== '--' ? 'CE' : (r.PE_Symbol && r.PE_Symbol !== '--' ? 'PE' : '--'));
                const sym = r.Symbol || r.CE_Symbol || r.PE_Symbol || '--';

                const expEntry = r.Expected_Entry_Price && r.Expected_Entry_Price !== '--' && parseFloat(r.Expected_Entry_Price) > 0 ? `₹${parseFloat(r.Expected_Entry_Price).toFixed(2)}` : '--';
                const actEntry = r.Actual_Entry_Price && r.Actual_Entry_Price !== '--' && parseFloat(r.Actual_Entry_Price) > 0 ? `₹${parseFloat(r.Actual_Entry_Price).toFixed(2)}` : (r.CE_Entry_Price || r.PE_Entry_Price || '--');

                const expExit = r.Expected_Exit_Price && r.Expected_Exit_Price !== '--' && parseFloat(r.Expected_Exit_Price) > 0 ? `₹${parseFloat(r.Expected_Exit_Price).toFixed(2)}` : '--';
                const actExit = r.Actual_Exit_Price && r.Actual_Exit_Price !== '--' && parseFloat(r.Actual_Exit_Price) > 0 ? `₹${parseFloat(r.Actual_Exit_Price).toFixed(2)}` : (r.CE_Exit_Price || r.PE_Exit_Price || '--');

                const totSlipInr = parseFloat(r.Total_Slippage_INR || 0);
                const totSlipPts = (parseFloat(r.Entry_Slippage_Pts || 0) + parseFloat(r.Exit_Slippage_Pts || 0));
                const isFavorable = totSlipInr >= 0;
                const slipBadge = (r.Total_Slippage_INR !== undefined && (totSlipPts !== 0 || totSlipInr !== 0))
                    ? `<span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 11px; color: ${isFavorable ? '#16a34a' : '#dc2626'};">${isFavorable ? '+' : ''}₹${totSlipInr.toFixed(2)} (${isFavorable ? '+' : ''}${totSlipPts.toFixed(2)} pts)</span>`
                    : '<span style="color: var(--text-muted); font-size: 11px;">0.00 pts</span>';

                const isClosed = r.Status === 'CLOSED' || r.Status === 'RECORDED';

                return `
                <tr>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;">#${r.Serial_No}</td>
                    <td style="font-weight: 600; color: var(--text-primary); font-family: monospace; font-size: 11px;">
                        ${r.Date}<br><span style="font-size: 10px; color: var(--text-muted);">${r.Time || r.Entry_Time || '--'}</span>
                    </td>
                    <td style="font-weight: 700; color: var(--accent-light);">${sname}</td>
                    <td>
                        <span class="badge-tag badge-nifty" style="font-size: 11px;">${inst}</span>
                        ${leg !== '--' ? `<span class="badge-tag" style="font-weight: 700; font-size: 10px; margin-left: 4px;">${leg}</span>` : ''}
                        <br><span style="font-size: 10px; color: var(--text-muted); font-family: monospace;">${sym}</span>
                    </td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 600;">${lot}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">
                        <span style="color: var(--text-muted);">Exp:</span> ${expEntry}<br><b>Fill:</b> ${actEntry}
                    </td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">
                        <span style="color: var(--text-muted);">Trig:</span> ${expExit}<br><b>Fill:</b> ${actExit}
                    </td>
                    <td>${slipBadge}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800;" class="${getPnlClass(dayPnl)}">${formatPnl(dayPnl)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800;" class="${getPnlClass(cumPnl)}">${formatPnl(cumPnl)}</td>
                    <td><span style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">${r.Exit_Reason || '--'}</span></td>
                    <td><span class="badge-tag ${isClosed ? 'badge-complete' : 'badge-active'}">${r.Status || 'RECORDED'}</span></td>
                </tr>`;
            }).join('');
        }

        async function exportIntradayPnL() {
            toast('⏳ Calculating and generating intraday P&L report...');
            try {
                const res = await api('/api/pnl/export', 'POST');
                if (res.status === 'ok') {
                    toast('✅ Intraday PnL saved to intraday_PnL.csv! Downloading...');
                    fetchIntradayPnlSummary();
                    window.location.href = '/api/pnl/download';
                } else {
                    toast('❌ Error generating report: ' + (res.message || 'Unknown error'), true);
                }
            } catch (e) {
                toast('❌ Network error while exporting PnL', true);
            }
        }

        function renderOrderBook(orders) {
            const tbody = document.getElementById('orderBookBody');
            const badge = document.getElementById('orderCountBadge');

            const breakevenSlIds = new Set();
            const reentriesDoneMap = {};
            const strategyOrderIds = new Set();
            const strategyTags = new Set();
            const strategySymbols = new Set();
            const posSymbols = new Set();

            loadedStrategies.forEach(strat => {
                if (strat.run_tag) strategyTags.add(strat.run_tag);
                if (strat.selected_ce) strategySymbols.add(strat.selected_ce);
                if (strat.selected_pe) strategySymbols.add(strat.selected_pe);
                if (strat.orders) {
                    ['CE', 'PE'].forEach(leg => {
                        const legObj = strat.orders[leg];
                        if (legObj) {
                            if (legObj.symbol) strategySymbols.add(legObj.symbol);
                            if (legObj.sell_order_id) strategyOrderIds.add(String(legObj.sell_order_id));
                            if (legObj.sl_order_id) strategyOrderIds.add(String(legObj.sl_order_id));
                            if (legObj.sl_order_id && legObj.sl_modified_to_be) breakevenSlIds.add(String(legObj.sl_order_id));
                            if (legObj.sell_order_id && legObj.reentries_done > 0) reentriesDoneMap[String(legObj.sell_order_id)] = legObj.reentries_done;
                            if (legObj.sl_order_id && legObj.reentries_done > 0) reentriesDoneMap[String(legObj.sl_order_id)] = legObj.reentries_done;
                        }
                    });
                }
            });

            loadedPosStrategies.forEach(strat => {
                if (strat.run_tag) strategyTags.add(strat.run_tag);
                if (strat.selected_ce) { strategySymbols.add(strat.selected_ce); posSymbols.add(strat.selected_ce); }
                if (strat.selected_pe) { strategySymbols.add(strat.selected_pe); posSymbols.add(strat.selected_pe); }
                if (strat.orders) {
                    ['CE', 'PE'].forEach(leg => {
                        const legObj = strat.orders[leg];
                        if (legObj) {
                            if (legObj.symbol) { strategySymbols.add(legObj.symbol); posSymbols.add(legObj.symbol); }
                            if (legObj.order_id) strategyOrderIds.add(String(legObj.order_id));
                            if (legObj.sl_order_id) strategyOrderIds.add(String(legObj.sl_order_id));
                            if (legObj.reentry_order_id) strategyOrderIds.add(String(legObj.reentry_order_id));
                            if (legObj.sl_order_id && legObj.sl_modified_to_be) breakevenSlIds.add(String(legObj.sl_order_id));
                            if (legObj.order_id && legObj.reentries_done > 0) reentriesDoneMap[String(legObj.order_id)] = legObj.reentries_done;
                            if (legObj.sl_order_id && legObj.reentries_done > 0) reentriesDoneMap[String(legObj.sl_order_id)] = legObj.reentries_done;
                        }
                    });
                }
            });

            const stratOrders = (orders || []).filter(o => {
                const tag = (o.tag || '').trim();
                const oid = String(o.order_id || '');
                const sym = (o.tradingsymbol || '').trim();
                return strategyOrderIds.has(oid) ||
                    (tag && (tag.startsWith('s') || tag.startsWith('straddle') || tag.startsWith('ps_') || strategyTags.has(tag))) ||
                    strategySymbols.has(sym);
            });

            badge.textContent = stratOrders.length;

            if (!stratOrders || stratOrders.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" style="text-align: center; color: var(--text-muted); padding: 24px;">
                            No strategy orders placed yet. Orders will appear automatically upon entry execution.
                        </td>
                    </tr>`;
                return;
            }

            tbody.innerHTML = stratOrders.map(o => {
                const timeStr = o.order_timestamp ? o.order_timestamp.substring(11, 19) : '--';
                const tag = o.tag || '--';
                const symbol = o.tradingsymbol || '--';
                const txn = (o.transaction_type || 'BUY').toUpperCase();
                const txnClass = txn === 'BUY' ? 'badge-buy' : 'badge-sell';
                const orderType = o.order_type || 'LIMIT';
                const product = (o.product || 'MIS').toUpperCase();
                const qty = o.quantity || 0;
                const price = parseFloat(o.price || 0).toFixed(2);
                const triggerPrice = parseFloat(o.trigger_price || 0) > 0 ? `₹${parseFloat(o.trigger_price).toFixed(2)}` : '--';
                const status = (o.status || 'OPEN').toUpperCase();

                const isPosOrder = tag.startsWith('ps_') || posSymbols.has(symbol) || product === 'NRML';
                const stratTypeBadge = isPosOrder
                    ? `<span style="background:#ede9fe; color:#6d28d9; border:1px solid #ddd6fe; font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; margin-right:4px;">🧭 POS</span>`
                    : `<span style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; margin-right:4px;">⚡ INTRA</span>`;

                let statusBadgeClass = 'badge-open';
                if (status === 'COMPLETE') statusBadgeClass = 'badge-complete';
                else if (status === 'CANCELLED') statusBadgeClass = 'badge-cancelled';
                else if (status === 'REJECTED') statusBadgeClass = 'badge-rejected';

                const isSlOrder = orderType === 'SL' || orderType === 'SL-M';
                const isBreakeven = breakevenSlIds.has(String(o.order_id));
                const reentryDone = reentriesDoneMap[String(o.order_id)];

                let slStatusHtml = '--';
                if (isSlOrder) {
                    if (isBreakeven) {
                        slStatusHtml = `<span class="badge-tag badge-be">🎯 Breakeven Active (₹${price})</span>`;
                    } else if (status === 'COMPLETE') {
                        slStatusHtml = `<span class="badge-tag badge-sl-hit">💥 SL Hit / Triggered</span>`;
                    } else if (status === 'TRIGGER PENDING' || status === 'OPEN') {
                        slStatusHtml = `<span class="badge-tag badge-open">🛡️ SL Protected (${triggerPrice})</span>`;
                    } else {
                        slStatusHtml = `<span class="badge-tag badge-cancelled">SL ${status}</span>`;
                    }
                } else if (reentryDone) {
                    slStatusHtml = `<span class="badge-tag badge-reentry">🔄 Re-entry #${reentryDone}</span>`;
                }

                return `
                <tr>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted);">${timeStr}</td>
                    <td>${stratTypeBadge}<span style="background: var(--pastel-blue-bg); color: var(--pastel-blue-dark); border: 1px solid var(--pastel-blue-border); font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">${tag}</span></td>
                    <td style="font-weight: 700; color: var(--text-primary); font-family: monospace;">${symbol}</td>
                    <td><span class="badge-tag ${txnClass}">${txn}</span></td>
                    <td><span style="font-size: 11px; font-weight: 600;">${orderType} (${product})</span></td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;">${qty}</td>
                    <td style="font-family: 'JetBrains Mono', monospace;">₹${price}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--accent-light);">${triggerPrice}</td>
                    <td><span class="badge-tag ${statusBadgeClass}">${status}</span></td>
                    <td>${slStatusHtml}</td>
                </tr>`;
            }).join('');
        }

        function renderPositionsTable(positions) {
            const tbody = document.getElementById('positionsBody');

            const intradaySymbols = new Set();
            loadedStrategies.forEach(s => {
                if (s.selected_ce) intradaySymbols.add(s.selected_ce);
                if (s.selected_pe) intradaySymbols.add(s.selected_pe);
                if (s.orders) {
                    if (s.orders.CE && s.orders.CE.symbol) intradaySymbols.add(s.orders.CE.symbol);
                    if (s.orders.PE && s.orders.PE.symbol) intradaySymbols.add(s.orders.PE.symbol);
                }
            });

            const posSymbols = new Set();
            loadedPosStrategies.forEach(s => {
                if (s.selected_ce) posSymbols.add(s.selected_ce);
                if (s.selected_pe) posSymbols.add(s.selected_pe);
                if (s.orders) {
                    if (s.orders.CE && s.orders.CE.symbol) posSymbols.add(s.orders.CE.symbol);
                    if (s.orders.PE && s.orders.PE.symbol) posSymbols.add(s.orders.PE.symbol);
                }
            });

            const allStratPositions = (positions || []).filter(p => {
                const sym = (p.tradingsymbol || '').trim();
                return intradaySymbols.has(sym) || posSymbols.has(sym);
            });

            if (!allStratPositions || allStratPositions.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
                            No active strategy positions recorded.
                        </td>
                    </tr>`;
                return;
            }

            const intraList = allStratPositions.filter(p => intradaySymbols.has((p.tradingsymbol || '').trim()));
            const posList = allStratPositions.filter(p => posSymbols.has((p.tradingsymbol || '').trim()));

            let html = '';

            const renderRows = (list, sectionTitle, badgeColor) => {
                if (!list || list.length === 0) return '';
                const subTotalPnl = list.reduce((acc, cur) => acc + parseFloat(cur.pnl || cur.m2m || 0), 0);
                const subUnrealized = list.reduce((acc, cur) => acc + parseFloat(cur.unrealised || cur.unrealized || 0), 0);

                let sHtml = `
                <tr style="background: rgba(240, 244, 248, 0.8); font-weight: 700;">
                    <td colspan="5" style="padding: 10px 14px; color: var(--text-primary);">
                        <span style="background: ${badgeColor}; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 8px;">${sectionTitle}</span>
                        <span>(${list.length} Contracts)</span>
                    </td>
                    <td style="font-size: 11px; color: var(--text-secondary); text-align: right;">Subtotal:</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;" class="${getPnlClass(subUnrealized)}">${formatPnl(subUnrealized)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800; font-size: 13px;" class="${getPnlClass(subTotalPnl)}">${formatPnl(subTotalPnl)}</td>
                </tr>`;

                sHtml += list.map(p => {
                    const symbol = p.tradingsymbol || '--';
                    const product = p.product || 'MIS';
                    const qty = parseInt(p.quantity) || 0;
                    const buyAvg = parseFloat(p.buy_price || p.average_price || 0);
                    const sellAvg = parseFloat(p.sell_price || 0);
                    const avgPrice = qty < 0 ? (sellAvg || buyAvg) : buyAvg;
                    const ltp = parseFloat(p.last_price || 0);
                    const value = (Math.abs(qty) * ltp).toFixed(2);
                    const unrealized = parseFloat(p.unrealised || p.unrealized || 0);
                    const totalPnl = parseFloat(p.pnl || p.m2m || 0);

                    const qtyBadge = qty < 0
                        ? `<span class="badge-tag badge-sell">${qty} (SHORT)</span>`
                        : (qty > 0 ? `<span class="badge-tag badge-buy">+${qty} (LONG)</span>` : `<span class="badge-tag badge-cancelled">0 (CLOSED)</span>`);

                    return `
                    <tr>
                        <td style="font-weight: 700; font-family: monospace; color: var(--text-primary); padding-left: 20px;">${symbol}</td>
                        <td><span style="font-size: 11px; font-weight: 600;">${product}</span></td>
                        <td>${qtyBadge}</td>
                        <td style="font-family: 'JetBrains Mono', monospace;">₹${avgPrice.toFixed(2)}</td>
                        <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;">₹${ltp.toFixed(2)}</td>
                        <td style="font-family: 'JetBrains Mono', monospace;">₹${value}</td>
                        <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;" class="${getPnlClass(unrealized)}">${formatPnl(unrealized)}</td>
                        <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800;" class="${getPnlClass(totalPnl)}">${formatPnl(totalPnl)}</td>
                    </tr>`;
                }).join('');

                return sHtml;
            };

            html += renderRows(intraList, '⚡ Intraday Strategy Positions (MIS)', '#2563eb');
            html += renderRows(posList, '🧭 Positional Strategy Positions (NRML)', '#7c3aed');

            tbody.innerHTML = html;
        }

        // ═══════════════════════════════════════════════════════════════
        // MULTI-STRATEGY MANAGEMENT
        // ═══════════════════════════════════════════════════════════════

        let activeStrategyType = 'STRANGLE';
        let activeEntryAction = 'SELL';
        let brokerLotSizes = { NIFTY: 65, BANKNIFTY: 30, FINNIFTY: 25, MIDCPNIFTY: 50, SENSEX: 10, BANKEX: 15 };

        function getBrokerLotSize(indexName) {
            if (!indexName) return 65;
            const idx = String(indexName).trim().toUpperCase();
            if (brokerLotSizes[idx]) return Number(brokerLotSizes[idx]);
            if (idx.includes('BANKNIFTY') || idx.includes('BANK')) return Number(brokerLotSizes['BANKNIFTY'] || 30);
            if (idx.includes('FIN')) return Number(brokerLotSizes['FINNIFTY'] || 25);
            if (idx.includes('MIDCP') || idx.includes('MIDCAP')) return Number(brokerLotSizes['MIDCPNIFTY'] || 50);
            if (idx.includes('SENSEX')) return Number(brokerLotSizes['SENSEX'] || 10);
            if (idx.includes('BANKEX')) return Number(brokerLotSizes['BANKEX'] || 15);
            return Number(brokerLotSizes[idx] || 65);
        }

        function setEntryAction(action) {
            activeEntryAction = action;
            document.getElementById('btnActionSell').classList.toggle('active', action === 'SELL');
            document.getElementById('btnActionBuy').classList.toggle('active', action === 'BUY');
        }

        async function loadLotSizes() {
            try {
                const sizes = await api('/api/lot-sizes');
                if (sizes && typeof sizes === 'object' && Object.keys(sizes).length > 0) {
                    for (const [k, v] of Object.entries(sizes)) {
                        brokerLotSizes[String(k).toUpperCase()] = Number(v);
                    }
                    if (document.getElementById('indexName')) {
                        updateQuantityField(document.getElementById('indexName').value);
                    }
                    if (document.getElementById('posIndexName')) {
                        onPosIndexChange();
                    }
                }
            } catch (e) {
                console.error('Failed to load lot sizes:', e);
            }
        }

        async function fetchAndRenderStrategies() {
            const list = await api('/api/strategies');
            if (Array.isArray(list)) {
                loadedStrategies = list;
                renderStrategies(list);
            }
        }

        function renderStrategies(list) {
            const container = document.getElementById('strategiesList');
            const countBadge = document.getElementById('strategyCountBadge');

            const activeCount = list.filter(s => s.active).length;
            countBadge.textContent = `${activeCount} / ${list.length} Running`;

            if (inlineEditingStratIds.size > 0 && Array.from(inlineEditingStratIds).some(id => (list || []).some(s => s.id === id))) {
                return; // Pause re-rendering while user is typing in an inline card in Tab 4
            }

            if (list.length === 0) {
                container.style.display = 'block';
                container.innerHTML = `<div style="background: var(--bg-card); border: 1px dashed var(--border-color); padding: 24px; border-radius: var(--radius-md); text-align: center; color: var(--text-secondary);">No intraday strategies created yet. Click "+ New Strategy" to create one.</div>`;
                return;
            }

            container.style.display = 'block';

            // Group intraday strategies by instrument
            const groups = {};
            list.forEach(s => {
                const inst = (s.index_name || 'NIFTY').toUpperCase();
                if (!groups[inst]) groups[inst] = [];
                groups[inst].push(s);
            });

            const instrumentOrder = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];
            const allInstruments = Array.from(new Set([...instrumentOrder, ...Object.keys(groups)]));

            container.innerHTML = allInstruments.filter(inst => groups[inst] && groups[inst].length > 0).map(instrumentName => {
                const strats = groups[instrumentName];

                // Sort chronologically by start_time (e.g. 09:20:00, 09:30:00, etc.)
                strats.sort((a, b) => {
                    const timeA = (a.start_time || '09:20:00').padStart(8, '0');
                    const timeB = (b.start_time || '09:20:00').padStart(8, '0');
                    return timeA.localeCompare(timeB);
                });

                const groupActiveCount = strats.filter(s => s.active).length;

                const cardsHtml = strats.map(s => {
                    const isActive = s.active;
                    const statusClass = isActive ? 'connected' : 'disconnected';
                    const statusText = s.status || (isActive ? 'Running' : 'Idle');
                    const action = (s.entry_action || 'SELL').toUpperCase();
                    const actionBadge = action === 'BUY'
                        ? `<span style="background: #e6f4ea; color: #137333; border: 1px solid #ceead6; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">🟢 BUY</span>`
                        : `<span style="background: #fce8e6; color: #c5221f; border: 1px solid #fad2cf; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">🔴 SELL</span>`;

                    const isCollapsed = isStrategyCardCollapsed(s.id);
                    const pnl = getStrategyPnl(s);
                    const innerMode = getStratInnerMode(s.id);

                    // Breakeven & SL status indicators on the card
                    let ceBeTag = '';
                    let peBeTag = '';
                    if (s.orders) {
                        if (s.orders.CE && s.orders.CE.sl_modified_to_be) {
                            ceBeTag = `<span class="badge-tag badge-be" style="font-size: 9px; padding: 1px 5px; margin-left: 4px;">🎯 BE</span>`;
                        }
                        if (s.orders.PE && s.orders.PE.sl_modified_to_be) {
                            peBeTag = `<span class="badge-tag badge-be" style="font-size: 9px; padding: 1px 5px; margin-left: 4px;">🎯 BE</span>`;
                        }
                    }

                    const ceSym = s.selected_ce || (s.orders && s.orders.CE && s.orders.CE.symbol) || '--';
                    const ceLtp = parseFloat((s.orders && s.orders.CE && s.orders.CE.current_ltp) || s.selected_ce_ltp || 0).toFixed(2);
                    const peSym = s.selected_pe || (s.orders && s.orders.PE && s.orders.PE.symbol) || '--';
                    const peLtp = parseFloat((s.orders && s.orders.PE && s.orders.PE.current_ltp) || s.selected_pe_ltp || 0).toFixed(2);

                    const strikesHtml = (s.selected_ce || (s.orders && s.orders.CE && s.orders.CE.symbol))
                        ? `<div style="margin-top: 8px; padding: 8px; background: var(--pastel-blue-bg); border-radius: 6px; border: 1px solid var(--pastel-blue-border); font-size: 11px;">
                            <div style="font-weight: 700; color: var(--pastel-blue-dark); margin-bottom: 4px; display: flex; justify-content: space-between;">
                                <span>📍 Selected Option Strikes</span>
                                ${s.run_tag ? `<span style="font-size: 10px; color: var(--text-secondary); font-family: monospace;">Tag: ${s.run_tag}</span>` : ''}
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                                <span style="color: #3b8a59; font-weight: 700;">CE ↑ ${ceBeTag}</span>
                                <span style="font-family: monospace; color: var(--text-primary); font-weight: 700;">${ceSym} &nbsp; ₹${ceLtp}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: #cc8420; font-weight: 700;">PE ↓ ${peBeTag}</span>
                                <span style="font-family: monospace; color: var(--text-primary); font-weight: 700;">${peSym} &nbsp; ₹${peLtp}</span>
                            </div>
                        </div>`
                        : `<div style="margin-top: 8px; padding: 8px; background: var(--pastel-blue-bg); border-radius: 6px; border: 1px dashed var(--pastel-blue-border); font-size: 11px; color: var(--pastel-blue-dark); text-align: center; font-weight: 600;">
                            🎯 Strikes not calculated — click 🔍 Calc
                        </div>`;

                    const reentryBadge = s.reentry_count > 0
                        ? `<span style="background: #ede9fe; color: #6d28d9; border: 1px solid #ddd6fe; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">🔄 Re-entry: ${s.reentry_count}x</span>`
                        : '';

                    const tslBadge = s.enable_tsl
                        ? `<span style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">🎯 TSL: ${s.tsl_points || 10} pts</span>`
                        : '';

                    const intraLotSize = getBrokerLotSize(s.index_name || 'NIFTY');
                    const intraTotalLots = Math.max(1, Math.round((s.quantity || intraLotSize) / intraLotSize));
                    const intraLotBadge = `<span style="background: #f8fafc; color: #475569; border: 1px solid #cbd5e1; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;" title="Strategy Lot Size">📦 ${s.quantity || intraLotSize} Qty (${intraTotalLots} Lot${intraTotalLots > 1 ? 's' : ''})</span>`;

                    return `
                    <div class="card strat-card" data-strat-id="${s.id}" data-group-id="${instrumentName}" style="border-top: 3px solid ${isActive ? 'var(--success)' : 'var(--border-color)'}; padding: 0;">
                        <!-- Collapsible Header Summary Strip -->
                        <div class="strat-card-header" onclick="toggleStrategyCard('${s.id}')">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span id="stratCardChevron_${s.id}" class="strat-card-chevron ${isCollapsed ? 'collapsed' : ''}">▼</span>
                                <span style="font-size: 14px; font-weight: 800; color: var(--text-primary);">${s.name || 'Unnamed Strategy'}</span>
                                <span style="background: var(--pastel-blue-bg); color: var(--pastel-blue-dark); border: 1px solid var(--pastel-blue-border); font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">${s.index_name}</span>
                                <span style="background: #ffffff; color: var(--text-secondary); border: 1px solid var(--border-color); font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;">${s.strategy_type} (${s.product || 'MIS'})</span>
                                ${intraLotBadge}
                                ${actionBadge}
                                ${reentryBadge}
                                ${tslBadge}
                                <span class="status-pill ${statusClass}" style="margin: 0; padding: 2px 8px; font-size: 10px;">
                                    <span class="status-dot"></span>
                                    <span>${statusText}</span>
                                </span>
                            </div>

                            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                                <span style="background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; font-family: monospace;" title="Expiry Date">
                                    📅 ${formatStrategyExpiry(s)}
                                </span>
                                ${formatStrategyDelta(s)}
                                <div style="display: flex; align-items: center; gap: 5px;">
                                    <span style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">PnL:</span>
                                    <span class="${getPnlClass(pnl)}" style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 800; padding: 2px 8px; border-radius: 6px; background: #ffffff; border: 1px solid var(--border-color); white-space: nowrap;">${formatPnl(pnl)}</span>
                                </div>

                                <!-- Quick Action Buttons -->
                                <div style="display: flex; gap: 5px; align-items: center;" onclick="event.stopPropagation()">
                                    <button onclick="toggleSingleStrategy('${s.id}', ${!isActive})" class="btn-primary" style="padding: 4px 10px; font-size: 11px; width: auto; background: ${isActive ? 'linear-gradient(135deg, var(--error), #b8433e)' : 'linear-gradient(135deg, #7ea0c1, #698ea9)'}; border-color: ${isActive ? '#b8433e' : '#6385a0'};">
                                        ${isActive ? '🛑 Stop' : '▶️ Run'}
                                    </button>
                                    <button onclick="calculateStrikes('${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto;" title="Calc Strikes">🔍 Calc</button>
                                    <button onclick="squareoffSingleStrategy('${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto; color: var(--error); border-color: rgba(203, 83, 78, 0.4);" title="Exit Strategy">⚡ Exit</button>
                                    <button onclick="toggleStrategyInlineEdit('INTRA', '${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto; background: ${innerMode === 'EDIT' ? 'var(--pastel-blue-bg)' : '#ffffff'}; color: ${innerMode === 'EDIT' ? 'var(--pastel-blue-dark)' : 'inherit'}; font-weight: 700;" title="Edit Strategy directly within card">✏️ Edit</button>
                                    <button onclick="deleteStrategy('${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto; color: var(--error); border-color: rgba(203, 83, 78, 0.4);" title="Delete Strategy">🗑️</button>
                                </div>
                            </div>
                        </div>

                        <!-- Collapsible Body Content -->
                        <div id="stratCardBody_${s.id}" class="strat-card-body" style="display: ${isCollapsed ? 'none' : 'block'}; padding: 14px 18px 18px 18px; border-top: 1px solid var(--border-color);">
                            <!-- Inner Tabs: Live Monitor vs Edit Strategy -->
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; gap: 6px;">
                                    <button type="button" id="btnModeView_${s.id}" onclick="switchStratInnerMode('${s.id}', 'VIEW')" class="btn-secondary" style="font-size: 11px; font-weight: ${innerMode === 'VIEW' ? '800' : '600'}; padding: 4px 10px; ${innerMode === 'VIEW' ? 'background: var(--pastel-blue-bg); color: var(--pastel-blue-dark); border-color: var(--pastel-blue-border);' : 'background: #ffffff; color: var(--text-secondary);'}">
                                        📊 Live Monitor
                                    </button>
                                    <button type="button" id="btnModeEdit_${s.id}" onclick="switchStratInnerMode('${s.id}', 'EDIT')" class="btn-secondary" style="font-size: 11px; font-weight: ${innerMode === 'EDIT' ? '800' : '600'}; padding: 4px 10px; ${innerMode === 'EDIT' ? 'background: var(--pastel-blue-bg); color: var(--pastel-blue-dark); border-color: var(--pastel-blue-border);' : 'background: #ffffff; color: var(--text-secondary);'}">
                                        ✏️ Edit Strategy
                                    </button>
                                </div>
                                <span style="font-size: 11px; color: var(--text-secondary); font-family: monospace;">ID: ${s.id}</span>
                            </div>

                            <!-- Live Monitor View Panel -->
                            <div id="stratViewPanel_${s.id}" style="display: ${innerMode === 'VIEW' ? 'block' : 'none'};">
                                <div style="background: #ffffff; padding: 12px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 8px; border: 1px solid var(--border-color); box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <span style="color: var(--text-secondary); font-weight: 600;">Window:</span>
                                        <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--accent-light);">⏰ ${s.start_time || '09:20:00'} ➔ 🔔 ${s.end_time || '15:15:00'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <span style="color: var(--text-secondary); font-weight: 600;">Expiry:</span>
                                        <span style="font-family: monospace; color: var(--text-primary); font-weight: 700;">
                                            ${s.expiry === 'CURRENT' ? '⚡ Current Expiry' + (s.resolved_expiry ? ` (${s.resolved_expiry})` : '') :
                                s.expiry === 'NEXT' ? '📅 Next Expiry' + (s.resolved_expiry ? ` (${s.resolved_expiry})` : '') :
                                    (s.expiry || '--')}
                                        </span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <span style="color: var(--text-secondary); font-weight: 600;">Targets:</span>
                                        <span style="color: var(--text-primary); font-weight: 600;">CE ₹${s.ce_premium} | PE ₹${s.pe_premium}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <span style="color: var(--text-secondary); font-weight: 600;">SL &amp; Trailing:</span>
                                        <span style="color: var(--text-primary); font-weight: 600;">${(s.sl_type === 'PERCENT') ? `${s.sl_percent || s.sl_points || 20}% SL` : `${s.sl_points || 20} pts SL`} | TSL: ${s.enable_tsl ? `${s.tsl_points || 10} pts` : 'OFF'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between;">
                                        <span style="color: var(--text-secondary); font-weight: 600;">Re-entry &amp; Qty:</span>
                                        <span style="color: var(--text-primary); font-weight: 600;">${s.reentry_count || 0} max (${(s.orders && s.orders.CE && s.orders.CE.reentries_done) || 0} CE / ${(s.orders && s.orders.PE && s.orders.PE.reentries_done) || 0} PE done) | Qty: ${s.quantity}</span>
                                    </div>
                                    ${strikesHtml}
                                </div>
                            </div>

                            <!-- Inline Edit Panel -->
                            ${buildIntraInlineEditPanel(s)}
                        </div>
                    </div>`;
                }).join('');

                return `
                <div style="margin-bottom: 24px; background: rgba(255,255,255,0.65); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 18px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid var(--pastel-blue-border); flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 17px; font-weight: 800; color: var(--text-primary); text-transform: uppercase;">🏷️ ${instrumentName} Intraday Group</span>
                            <span style="background: var(--pastel-blue-bg); color: var(--pastel-blue-dark); font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--pastel-blue-border);">${strats.length} Strateg${strats.length === 1 ? 'y' : 'ies'}</span>
                            <button onclick="toggleAllStrategiesInGroup('${instrumentName}')" class="btn-secondary" style="font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">↕️ Toggle All</button>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="font-size: 12px; font-weight: 700; color: var(--pastel-blue-dark); background: #ffffff; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border-color);">
                                ⏱️ Sorted by Execution Time
                            </span>
                            <span style="font-size: 12px; font-weight: 700; color: ${groupActiveCount > 0 ? 'var(--success)' : 'var(--text-secondary)'};">
                                ${groupActiveCount} Active
                            </span>
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
                        ${cardsHtml}
                    </div>
                </div>`;
            }).join('');
        }


        async function toggleSingleStrategy(id, newActive) {
            const res = await api(`/api/strategies/${id}/toggle`, 'POST', { active: newActive });
            if (res.status === 'ok') {
                toast(newActive ? 'Strategy Activated' : 'Strategy Stopped');
                fetchAndRenderStrategies();
                refreshOrdersAndPositions();
            }
        }

        async function squareoffSingleStrategy(id) {
            if (!confirm('Are you sure you want to manually trigger the complete Exit Cycle for this intraday strategy?\n\nThis will cancel all open/pending SL & Re-entry orders, fetch net positions, and execute market square-off orders.')) return;
            toast('⚡ Starting Exit Cycle...');
            const res = await api(`/api/strategies/${id}/squareoff`, 'POST');
            if (res.status === 'ok') {
                toast('✅ ' + (res.message || 'Exit cycle executed successfully'));
                fetchAndRenderStrategies();
                refreshOrdersAndPositions();
            } else {
                toast('❌ ' + (res.message || 'Exit cycle failed'), true);
            }
        }

        async function calculateStrikes(id) {
            toast('⏳ Fetching option LTPs and calculating best strikes...');
            const res = await api(`/api/strategies/${id}/calculate`, 'POST');
            if (res.status === 'ok') {
                toast('✅ ' + (res.message || 'Strike calculation started'));
                setTimeout(fetchAndRenderStrategies, 5000); // refresh after 5s
            } else {
                toast('❌ ' + (res.message || 'Calculation failed'), true);
            }
        }

        async function runAllStrategies() {
            const res = await api('/api/strategies/run-all', 'POST');
            if (res.status === 'ok') {
                toast('All Strategies Activated');
                fetchAndRenderStrategies();
                refreshOrdersAndPositions();
            }
        }

        async function stopAllStrategies() {
            const res = await api('/api/strategies/stop-all', 'POST');
            if (res.status === 'ok') {
                toast('All Strategies Stopped');
                fetchAndRenderStrategies();
                refreshOrdersAndPositions();
            }
        }

        async function deleteStrategy(id) {
            if (!confirm('Are you sure you want to delete this strategy?')) return;
            const res = await api(`/api/strategies/${id}`, 'DELETE');
            if (res.status === 'ok') {
                toast('Strategy Deleted');
                fetchAndRenderStrategies();
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY NAME AUTO-SUGGEST HELPERS (NFT for Nifty, BNF for BankNifty, SNS for Sensex)
        // ═══════════════════════════════════════════════════════════════

        const INSTRUMENT_PREFIX_MAP = {
            'NIFTY': 'NFT',
            'BANKNIFTY': 'BNF',
            'SENSEX': 'SNS',
            'FINNIFTY': 'FNF',
            'MIDCPNIFTY': 'MID',
            'BANKEX': 'BNX'
        };

        function getInstrumentPrefix(idx) {
            if (!idx) return 'NFT';
            const upper = String(idx).trim().toUpperCase();
            if (INSTRUMENT_PREFIX_MAP[upper]) return INSTRUMENT_PREFIX_MAP[upper];
            if (upper.includes('BANKNIFTY') || upper.includes('BNF')) return 'BNF';
            if (upper.includes('SENSEX') || upper.includes('SNS')) return 'SNS';
            if (upper.includes('FIN')) return 'FNF';
            if (upper.includes('MID')) return 'MID';
            if (upper.includes('BANKEX')) return 'BNX';
            return upper.substring(0, 3);
        }

        function getExpiryMonth3Letter(expiryVal, indexName = 'NIFTY') {
            if (!expiryVal || expiryVal === 'CURRENT' || expiryVal === 'CURRENT_MONTH') {
                return new Date().toLocaleString('en-US', { month: 'short' }).toUpperCase();
            }
            if (expiryVal === 'NEXT' || expiryVal === 'NEXT_MONTH') {
                const nextM = new Date();
                nextM.setMonth(nextM.getMonth() + 1);
                return nextM.toLocaleString('en-US', { month: 'short' }).toUpperCase();
            }
            // If date format: YYYY-MM-DD or DD-MMM-YYYY
            const parsed = new Date(expiryVal);
            if (!isNaN(parsed.getTime())) {
                return parsed.toLocaleString('en-US', { month: 'short' }).toUpperCase();
            }
            const match = String(expiryVal).match(/[a-zA-Z]{3}/);
            if (match) return match[0].toUpperCase();
            return new Date().toLocaleString('en-US', { month: 'short' }).toUpperCase();
        }

        function formatTimeForName(timeStr) {
            if (!timeStr) return '09:20';
            const parts = timeStr.split(':');
            return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : timeStr;
        }

        function isAutoPattern(val) {
            if (!val) return true;
            const v = val.trim();
            if (v.startsWith('Strategy') || v.startsWith('Positional') || v.startsWith('Straddle')) return true;
            const prefixes = ['NFT', 'BNF', 'BNK', 'SNS', 'FNF', 'FIN', 'MID', 'SNX', 'BNX', 'BKX', 'NIFTY', 'BANKNIFTY', 'Nifty', 'BankNifty'];
            return prefixes.some(p => v.startsWith(p));
        }

        function autoSuggestIntradayName(force = false) {
            const nameInput = document.getElementById('stratName');
            if (!nameInput) return;
            const currentVal = nameInput.value.trim();
            if (force || !currentVal || isAutoPattern(currentVal)) {
                const idx = document.getElementById('indexName').value || 'NIFTY';
                const prefix = getInstrumentPrefix(idx);
                const timeVal = formatTimeForName(document.getElementById('startTime').value || '09:20:00');
                const stratType = activeStrategyType === 'STRADDLE' ? 'strddl' : 'strngl';
                const prod = (document.getElementById('productSelect') ? document.getElementById('productSelect').value : 'MIS').toLowerCase();
                nameInput.value = `${prefix}_${timeVal}_${stratType}_${prod}`;
            }
        }

        function autoSuggestPosName(force = false) {
            const nameInput = document.getElementById('posStratName');
            if (!nameInput) return;
            const currentVal = nameInput.value.trim();
            if (force || !currentVal || isAutoPattern(currentVal)) {
                const idx = document.getElementById('posIndexName').value || 'NIFTY';
                const prefix = getInstrumentPrefix(idx);
                const expVal = document.getElementById('posExpirySelect')?.value || 'CURRENT';
                const monthCode = getExpiryMonth3Letter(expVal, idx);
                const cePrem = document.getElementById('posCePremium') ? (document.getElementById('posCePremium').value || '80') : '80';
                nameInput.value = `${prefix} ${monthCode} STRNGL ${cePrem}`;
            }
        }

        function autoSuggestStraddleName(force = false) {
            const nameInput = document.getElementById('straddleStratName');
            if (!nameInput) return;
            const isEditing = Boolean(document.getElementById('straddleStratId').value);
            if (isEditing && !force) return;

            const idx = (document.getElementById('straddleIndexName').value || 'NIFTY').trim();
            const prefix = getInstrumentPrefix(idx);
            const stratType = document.getElementById('straddleStratType').value;
            const legSel = document.getElementById('straddleLegSelection').value;
            const strikeMode = document.getElementById('straddleStrikeMode').value;
            const manualStrike = document.getElementById('straddleManualStrike').value.trim();
            const strikeMult = document.getElementById('straddleStrikeMultiple').value.trim();
            const expVal = document.getElementById('straddleExpirySelect')?.value || 'CURRENT_MONTH';
            const monthCode = getExpiryMonth3Letter(expVal, idx);

            let suggested = '';
            let autoGrp = 'Straddle';

            if (stratType === 'INDIVIDUAL_LEG') {
                const optType = legSel === 'PE_ONLY' ? 'PE' : 'CE';
                autoGrp = legSel === 'PE_ONLY' ? 'PE_Only' : 'CE_Only';
                let strikeTag = 'ATM';
                if (strikeMode === 'MANUAL' && manualStrike) {
                    strikeTag = manualStrike;
                } else if (strikeMode === 'ROUND_OFF' && strikeMult) {
                    strikeTag = `Round ${strikeMult}`;
                }
                suggested = `${prefix} ${monthCode} ${optType} ${strikeTag}`;
            } else if (stratType === 'STRANGLE') {
                autoGrp = 'Strangle';
                const ceStrk = document.getElementById('straddleCeStrike').value.trim();
                const peStrk = document.getElementById('straddlePeStrike').value.trim();
                if (strikeMode === 'MANUAL' && ceStrk && peStrk) {
                    suggested = `${prefix} ${monthCode} STRNGL ${ceStrk}CE ${peStrk}PE`;
                } else if (strikeMode === 'PREMIUM') {
                    const cePrem = document.getElementById('straddleCeTargetPrem')?.value.trim() || '80';
                    const pePrem = document.getElementById('straddlePeTargetPrem')?.value.trim() || '80';
                    if (cePrem === pePrem) {
                        suggested = `${prefix} ${monthCode} STRNGL ${cePrem}`;
                    } else {
                        suggested = `${prefix} ${monthCode} STRNGL ${cePrem}CE ${pePrem}PE`;
                    }
                } else {
                    suggested = `${prefix} ${monthCode} STRNGL OTM`;
                }
            } else {
                // STRADDLE
                autoGrp = 'Straddle';
                let strikeTag = 'ATM';
                if (strikeMode === 'MANUAL' && manualStrike) {
                    strikeTag = manualStrike;
                } else if (strikeMode === 'ROUND_OFF' && strikeMult) {
                    strikeTag = `Round ${strikeMult}`;
                }
                suggested = `${prefix} ${monthCode} STRDL ${strikeTag} (CE+PE)`;
            }

            nameInput.value = suggested;
            const grpInput = document.getElementById('straddleGroupName');
            if (grpInput) grpInput.value = autoGrp;
        }

        function toggleIntraTslInput() {
            const enabled = document.getElementById('intraEnableTsl').checked;
            document.getElementById('intraTslPointsGroup').style.display = enabled ? 'block' : 'none';
        }

        function openNewStrategyForm() {
            toggleCardCollapse('strategyFormCollapseContent', 'strategyFormChevron', true);
            document.getElementById('stratId').value = '';
            setEntryAction('SELL');
            setStrategyType('STRANGLE');
            document.getElementById('slType').value = 'PERCENT';
            document.getElementById('stopLossValue').value = '20';
            updateSlInputDisplay();
            document.getElementById('intraEnableTsl').checked = false;
            document.getElementById('intraTslPoints').value = '10';
            toggleIntraTslInput();
            document.getElementById('reentryCount').value = '0';
            document.getElementById('formCardTitle').textContent = '➕ Create New Strategy';
            autoSuggestIntradayName(true);
            switchMainTab('tabConfigLogs');
            document.getElementById('strategyFormCard').scrollIntoView({ behavior: 'smooth' });
        }

        function updateSlInputDisplay() {
            const slType = document.getElementById('slType').value;
            const lbl = document.getElementById('lblStopLoss');
            const input = document.getElementById('stopLossValue');
            if (slType === 'PERCENT') {
                lbl.textContent = 'Stop Loss (%)';
                input.placeholder = 'e.g. 20 for 20%';
            } else {
                lbl.textContent = 'Stop Loss (Points)';
                input.placeholder = 'e.g. 20 points';
            }
        }

        function editStrategy(id) {
            toggleStrategyInlineEdit('INTRA', id);
        }

        function cancelEditForm() {
            document.getElementById('stratId').value = '';
            setEntryAction('SELL');
            document.getElementById('slType').value = 'PERCENT';
            document.getElementById('stopLossValue').value = '20';
            updateSlInputDisplay();
            document.getElementById('intraEnableTsl').checked = false;
            document.getElementById('intraTslPoints').value = '10';
            toggleIntraTslInput();
            document.getElementById('reentryCount').value = '0';
            document.getElementById('formCardTitle').textContent = '⚙️ Create / Edit Strategy';
            updateQuantityField(document.getElementById('indexName').value);
            autoSuggestIntradayName(true);
        }

        function setStrategyType(type) {
            activeStrategyType = type;
            document.getElementById('btnStrangle').classList.toggle('active', type === 'STRANGLE');
            document.getElementById('btnStraddle').classList.toggle('active', type === 'STRADDLE');

            const ceField = document.getElementById('cePremium');
            const peField = document.getElementById('pePremium');

            if (type === 'STRADDLE') {
                document.getElementById('lblCePremium').textContent = 'Target ATM Premium';
                document.getElementById('lblPePremium').parentElement.style.opacity = '0.5';
                peField.disabled = true;

                ceField.addEventListener('input', syncPremiums);
                peField.value = ceField.value;
            } else {
                document.getElementById('lblCePremium').textContent = 'Call Target Premium (CE)';
                document.getElementById('lblPePremium').parentElement.style.opacity = '1';
                peField.disabled = false;

                ceField.removeEventListener('input', syncPremiums);
            }
            autoSuggestIntradayName();
        }

        function syncPremiums(e) {
            document.getElementById('pePremium').value = e.target.value;
        }

        function updateQuantityField(indexName, resetToOneLot = false) {
            const lotSize = getBrokerLotSize(indexName);
            const qtyInput = document.getElementById('quantity');
            const qtyLabel = document.getElementById('lblQuantity');
            if (qtyInput) {
                qtyInput.step = lotSize;
                qtyInput.min = lotSize;
            }
            if (qtyLabel) qtyLabel.textContent = `Quantity (Multiple of ${lotSize} for ${indexName || 'Index'})`;
            if (qtyInput) {
                if (resetToOneLot) {
                    qtyInput.value = lotSize;
                } else {
                    const current = parseInt(qtyInput.value) || lotSize;
                    const snapped = Math.max(lotSize, Math.round(current / lotSize) * lotSize);
                    qtyInput.value = snapped;
                }
            }
        }

        document.getElementById('indexName').addEventListener('change', (e) => {
            const idx = e.target.value;
            updateQuantityField(idx, true);
            autoSuggestIntradayName();
            loadExpiries(idx);
        });

        document.getElementById('startTime').addEventListener('change', () => {
            autoSuggestIntradayName();
        });
        document.getElementById('startTime').addEventListener('input', () => {
            autoSuggestIntradayName();
        });

        if (document.getElementById('productSelect')) {
            document.getElementById('productSelect').addEventListener('change', () => {
                autoSuggestIntradayName();
            });
        }

        document.getElementById('quantity').addEventListener('blur', (e) => {
            const idxName = document.getElementById('indexName').value;
            const lotSize = getBrokerLotSize(idxName);
            const current = parseInt(e.target.value) || lotSize;
            const snapped = Math.max(lotSize, Math.round(current / lotSize) * lotSize);
            e.target.value = snapped;
        });

        async function loadExpiries(indexName) {
            const idx = indexName || document.getElementById('indexName').value || 'NIFTY';
            const data = await api(`/api/expiries?index=${idx}`);
            const select = document.getElementById('expirySelect');
            const currentVal = select.value;

            const dates = Array.isArray(data) ? data : (data?.dates || []);
            const curExp = (!Array.isArray(data) && data?.current_expiry) ? data.current_expiry : (dates[0] || '');
            const nextExp = (!Array.isArray(data) && data?.next_expiry) ? data.next_expiry : (dates[1] || curExp);

            if (dates && dates.length > 0) {
                let optionsHtml = '';
                optionsHtml += `<option value="CURRENT">⚡ Current Expiry (${curExp})</option>`;
                if (dates.length > 1) {
                    optionsHtml += `<option value="NEXT">📅 Next Expiry (${nextExp})</option>`;
                }
                optionsHtml += `<optgroup label="All Expiry Dates">`;
                dates.forEach(d => {
                    optionsHtml += `<option value="${d}">${d}</option>`;
                });
                optionsHtml += `</optgroup>`;

                select.innerHTML = optionsHtml;
                if (currentVal && (currentVal === 'CURRENT' || currentVal === 'NEXT' || dates.includes(currentVal))) {
                    select.value = currentVal;
                } else {
                    select.value = 'CURRENT';
                }
            } else {
                select.innerHTML = `<option value="CURRENT">Current Expiry</option><option value="NEXT">Next Expiry</option>`;
            }
        }

        async function saveStrategyConfig(e) {
            e.preventDefault();

            const chosenSlType = document.getElementById('slType').value;
            const slVal = parseFloat(document.getElementById('stopLossValue').value) || 20;

            const payload = {
                id: document.getElementById('stratId').value || undefined,
                name: document.getElementById('stratName').value.trim() || 'Strategy',
                strategy_type: activeStrategyType,
                entry_action: activeEntryAction,
                index_name: document.getElementById('indexName').value,
                expiry: document.getElementById('expirySelect').value,
                ce_premium: parseFloat(document.getElementById('cePremium').value),
                pe_premium: parseFloat(document.getElementById('pePremium').value),
                sl_type: chosenSlType,
                sl_points: chosenSlType === 'POINTS' ? slVal : undefined,
                sl_percent: chosenSlType === 'PERCENT' ? slVal : undefined,
                product: document.getElementById('productSelect').value,
                enable_tsl: document.getElementById('intraEnableTsl').checked,
                tsl_points: parseFloat(document.getElementById('intraTslPoints').value) || 10,
                start_time: ensureHHMMSS(document.getElementById('startTime').value.trim()),
                end_time: ensureHHMMSS(document.getElementById('endTime').value.trim()),
                quantity: parseInt(document.getElementById('quantity').value),
                reentry_count: parseInt(document.getElementById('reentryCount').value) || 0
            };

            try {
                const res = await api('/api/strategies', 'POST', payload);
                if (res && res.status === 'ok') {
                    toast('✅ Strategy Saved Successfully');
                    cancelEditForm();
                    fetchAndRenderStrategies();
                } else {
                    toast('❌ Error saving strategy: ' + ((res && res.message) || 'Server rejected request'), true);
                }
            } catch (err) {
                toast('❌ Network or Server error: ' + err.message, true);
            }
        }

        function ensureHHMMSS(val) {
            if (!val) return '09:20:00';
            const parts = val.split(':');
            if (parts.length === 2) return val + ':00';
            return val;
        }

        // ═══════════════════════════════════════════════════════════════
        // POSITIONAL STRANGLE STRATEGY (MULTI-STRATEGY & INSTRUMENT GROUPS)
        // ═══════════════════════════════════════════════════════════════

        let loadedPosStrategies = [];

        function onPosIndexChange(resetToOneLot = true) {
            const idx = document.getElementById('posIndexName').value || 'NIFTY';
            loadPosExpiries();
            const lot = getBrokerLotSize(idx);
            const qInput = document.getElementById('posQuantity');
            if (qInput) {
                if (resetToOneLot) {
                    qInput.value = lot;
                } else {
                    const current = parseInt(qInput.value) || lot;
                    const snapped = Math.max(lot, Math.round(current / lot) * lot);
                    qInput.value = snapped;
                }
                qInput.step = lot;
                qInput.min = lot;
            }
            const lbl = document.getElementById('lblPosQuantity');
            if (lbl) lbl.textContent = `Quantity (Multiple of Lot Size: ${lot} for ${idx})`;
            autoSuggestPosName();
        }

        async function loadPosExpiries(preferredExpiry) {
            const idx = document.getElementById('posIndexName').value || 'NIFTY';
            const data = await api(`/api/expiries?index=${idx}`);
            const select = document.getElementById('posExpirySelect');
            const dates = Array.isArray(data) ? data : (data?.dates || []);
            const monthlyDates = (!Array.isArray(data) && data?.monthly_expiries) ? data.monthly_expiries : [];
            const curMonthExp = (!Array.isArray(data) && data?.current_month_expiry) ? data.current_month_expiry : (monthlyDates[0] || dates[0] || '');
            const nextMonthExp = (!Array.isArray(data) && data?.next_month_expiry) ? data.next_month_expiry : (monthlyDates[1] || curMonthExp);

            if (dates && dates.length > 0) {
                let optionsHtml = '';
                optionsHtml += `<option value="CURRENT">⚡ Current Month Expiry (${curMonthExp})</option>`;
                if (nextMonthExp && nextMonthExp !== curMonthExp) {
                    optionsHtml += `<option value="NEXT">📅 Next Month Expiry (${nextMonthExp})</option>`;
                }

                if (monthlyDates.length > 0) {
                    optionsHtml += `<optgroup label="Monthly Expiries (Last Expiry of Month)">`;
                    monthlyDates.forEach(d => {
                        optionsHtml += `<option value="${d}">${d} (Monthly)</option>`;
                    });
                    optionsHtml += `</optgroup>`;
                }

                optionsHtml += `<optgroup label="All Upcoming Expiry Dates">`;
                dates.forEach(d => {
                    optionsHtml += `<option value="${d}">${d}</option>`;
                });
                optionsHtml += `</optgroup>`;

                select.innerHTML = optionsHtml;
                if (preferredExpiry && (preferredExpiry === 'CURRENT' || preferredExpiry === 'NEXT' || dates.includes(preferredExpiry))) {
                    select.value = preferredExpiry;
                } else {
                    select.value = 'CURRENT'; // Auto-select Current Month Expiry
                }
            } else {
                select.innerHTML = `<option value="CURRENT">Current Month Expiry</option><option value="NEXT">Next Month Expiry</option>`;
            }
        }

        async function fetchPosStrangleStatus(force = false) {
            if (!force && document.getElementById('consoleView').style.display !== 'block') return;
            try {
                const res = await api('/api/pos_strangle/status');
                if (res.status === 'ok') {
                    loadedPosStrategies = res.strategies || [];
                    renderPosInstrumentGroups(loadedPosStrategies);
                    renderPosLogs(res.logs || []);
                }
                fetchPosPnlSummary();
                fetchPosPendingOrders();
            } catch (e) {
                // Polling error
            }
        }

        function renderPosLogs(logs) {
            const term = document.getElementById('posLogsTerminal');
            if (logs && logs.length > 0) {
                term.innerHTML = logs.map(l => `<div class="log-line">${l}</div>`).join('');
                term.scrollTop = term.scrollHeight;
            }
            document.getElementById('posLastChecked').textContent = `Sync: ${new Date().toLocaleTimeString('en-IN')}`;
        }

        let lastPosRenderSignature = '';

        function renderPosInstrumentGroups(strategies) {
            const container = document.getElementById('posInstrumentGroupsContainer');
            if (!container) return;

            if (inlineEditingStratIds.size > 0 && Array.from(inlineEditingStratIds).some(id => (strategies || []).some(s => s.id === id))) {
                return; // Pause re-rendering while user is editing an inline card in Tab 5
            }

            if (!strategies || strategies.length === 0) {
                lastPosRenderSignature = '';
                container.innerHTML = `
                    <div class="card" style="text-align: center; padding: 32px; color: var(--text-muted);">
                        <p style="font-size: 14px; margin-bottom: 8px;">No Positional Strangle strategies created yet.</p>
                        <button onclick="openNewPosStrategyForm()" class="btn-primary" style="width: auto; padding: 6px 16px;">
                            ➕ Create Positional Strategy
                        </button>
                    </div>`;
                return;
            }

            // Update Tab status badge with count of active positional strangles
            const activeCount = strategies.filter(s => s.active).length;
            const tabBadge = document.getElementById('posStatusBadge');
            if (tabBadge) {
                tabBadge.textContent = activeCount > 0 ? `${activeCount} Active` : `${strategies.length} Strats`;
                tabBadge.style.background = activeCount > 0 ? '#dcfce7' : '#e0f2fe';
                tabBadge.style.color = activeCount > 0 ? '#15803d' : '#0369a1';
            }

            // Calculate overall Portfolio PnL for top bar
            const totalPosPnl = strategies.reduce((acc, curr) => acc + (parseFloat(getStrategyPnl(curr)) || 0), 0);

            // Filter strategies based on Instrument pill
            const filteredStrats = strategies.filter(s => {
                if (posFilterInstrumentState !== 'ALL') {
                    return (s.index_name || '').toUpperCase() === posFilterInstrumentState.toUpperCase();
                }
                return true;
            });

            // Sort: In-Action (active) on TOP, Idle below. Within each status group, NIFTY on top, BANKNIFTY below
            const getIndexOrder = (idx) => {
                const upper = (idx || '').toUpperCase();
                if (upper.includes('NIFTY') && !upper.includes('BANK')) return 1;
                if (upper.includes('BANK')) return 2;
                if (upper.includes('FIN')) return 3;
                if (upper.includes('MIDCP') || upper.includes('MID')) return 4;
                if (upper.includes('SENSEX')) return 5;
                return 10;
            };

            filteredStrats.sort((a, b) => {
                // 1. Active (In Action) on top, Idle/Inactive below
                const aActive = a.active ? 1 : 0;
                const bActive = b.active ? 1 : 0;
                if (aActive !== bActive) {
                    return bActive - aActive; // Active (1) first
                }
                // 2. Index priority: NIFTY on top (1), BANKNIFTY below (2), etc.
                const aIdx = getIndexOrder(a.index_name);
                const bIdx = getIndexOrder(b.index_name);
                if (aIdx !== bIdx) {
                    return aIdx - bIdx;
                }
                // 3. Alphabetical / creation fallback
                return (a.name || '').localeCompare(b.name || '');
            });

            // Compute structural signature (cards list, active status, subtabs, filter)
            const currentStructureSignature = JSON.stringify({
                filter: posFilterInstrumentState,
                strats: filteredStrats.map(s => ({
                    id: s.id,
                    name: s.name,
                    active: s.active,
                    index: s.index_name,
                    exp: s.expiry,
                    qty: s.quantity,
                    legs: (extractStrategyLegs(s) || []).map(l => `${l.symbol}_${l.strike}_${l.action}_${l.qty}`),
                    collapsed: isStrategyCardCollapsed(s.id),
                    subtab: getOpstraSubtab(s.id),
                    mode: getStratInnerMode(s.id)
                }))
            });

            // If structure is identical and container already has cards rendered, perform in-place updates without tearing DOM
            const existingCards = container.querySelectorAll('.opstra-strat-card');
            if (lastPosRenderSignature === currentStructureSignature && existingCards.length === filteredStrats.length) {
                // Update total PnL in top filter bar
                const totalPnlEl = container.querySelector('#posFilterBar .opstra-total-pnl-val');
                if (totalPnlEl) {
                    totalPnlEl.className = `opstra-total-pnl-val ${getPnlClass(totalPosPnl)}`;
                    totalPnlEl.textContent = formatPnl(totalPosPnl);
                }

                // Update dynamic values on each card
                filteredStrats.forEach(s => {
                    const card = container.querySelector(`.opstra-strat-card[data-strat-id="${s.id}"]`);
                    if (!card) return;

                    const pnl = getStrategyPnl(s);
                    const pnlEl = card.querySelector('.opstra-header-pnl');
                    if (pnlEl) {
                        pnlEl.className = `opstra-header-pnl ${getPnlClass(pnl)}`;
                        pnlEl.textContent = formatPnl(pnl);
                    }

                    const spotLtp = parseFloat(s.underlying_ltp || s.base_spot_entry || 0);
                    const spotEl = card.querySelector('.opstra-header-spot');
                    if (spotEl && spotLtp > 0) {
                        spotEl.textContent = `₹${spotLtp.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;
                    }

                    // Only update payoff chart smoothly if user is on PAYOFF subtab and chart exists
                    if (!isStrategyCardCollapsed(s.id) && getOpstraSubtab(s.id) === 'PAYOFF') {
                        renderOpstraPayoffChart(s.id, s);
                    }
                });
                return;
            }

            lastPosRenderSignature = currentStructureSignature;

            const cardsHtml = filteredStrats.map(s => {
                const isActive = s.active;
                const isCollapsed = isStrategyCardCollapsed(s.id);
                const pnl = getStrategyPnl(s);
                const currentSubtab = getOpstraSubtab(s.id);
                const metrics = calculateOpstraMetrics(s);
                const lotSize = getBrokerLotSize(s.index_name || 'NIFTY');
                const totalLots = Math.max(1, Math.round((s.quantity || lotSize) / lotSize));

                const spotLtp = parseFloat(s.underlying_ltp || s.base_spot_entry || metrics.spot || 0);
                const spotDiffPct = (s.base_spot_entry && s.underlying_ltp) ? ((s.underlying_ltp - s.base_spot_entry) / s.base_spot_entry * 100).toFixed(2) : '0.00';
                const spotDiffSign = parseFloat(spotDiffPct) >= 0 ? '+' : '';

                // Render Left Column Legs Checklist
                const legsHtml = metrics.legs.map(leg => {
                    const badgeClass = leg.action === 'SELL' ? 'opstra-badge-s' : 'opstra-badge-b';
                    const legPnl = (leg.entry && leg.ltp) ? (leg.action === 'SELL' ? (leg.entry - leg.ltp) * leg.qty : (leg.ltp - leg.entry) * leg.qty) : 0;
                    return `
                    <div class="opstra-leg-item">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="checkbox" checked style="cursor: pointer;">
                            <span class="${badgeClass}">${leg.action === 'SELL' ? 'S' : 'B'}</span>
                            <span style="font-weight: 700; color: #334155;">${totalLots}x</span>
                            <span style="font-weight: 700; color: #0f172a;">${s.index_name} ${formatStrategyExpiry(s)} ${leg.strike} ${leg.type}</span>
                        </div>
                        <div style="text-align: right; font-family: monospace;">
                            <span style="font-weight: 700; color: #0f172a;">₹${leg.ltp.toFixed(2)}</span>
                            <div style="font-size: 10px; font-weight: 800;" class="${getPnlClass(legPnl)}">${formatPnl(legPnl)}</div>
                        </div>
                    </div>`;
                }).join('');

                // Render Opstra Key Metrics Table
                const beString = metrics.breakevens.length > 0 ? metrics.breakevens.map(b => typeof b === 'number' ? `₹${b.toLocaleString('en-IN')}` : b).join(' - ') : '--';
                const metricsTableHtml = `
                <table class="opstra-metrics-table">
                    <tr><td class="metric-label">Prob. of Profit</td><td class="metric-val" style="color: #16a34a;">${metrics.pop}</td></tr>
                    <tr><td class="metric-label">Max. Profit</td><td class="metric-val" style="color: #16a34a;">${metrics.maxProfit}</td></tr>
                    <tr><td class="metric-label">Max. Loss</td><td class="metric-val" style="color: #dc2626;">${metrics.maxLoss}</td></tr>
                    <tr><td class="metric-label">Max RR Ratio</td><td class="metric-val">${metrics.rrRatio}</td></tr>
                    <tr><td class="metric-label">Breakevens</td><td class="metric-val" style="font-size: 10px;">${beString}</td></tr>
                    <tr><td class="metric-label">Total PNL</td><td class="metric-val ${getPnlClass(pnl)}">${formatPnl(pnl)}</td></tr>
                    <tr><td class="metric-label">Net Credit</td><td class="metric-val">₹${Math.round(metrics.netCredit).toLocaleString('en-IN')}</td></tr>
                    <tr><td class="metric-label">Estimated Margin</td><td class="metric-val">${metrics.estMargin}</td></tr>
                </table>`;

                // Render Subtab 2: Greeks Table with Totals
                let totalDelta = 0, totalTheta = 0, totalGamma = 0, totalVega = 0, sumIv = 0, legCount = 0;
                const greeksRows = metrics.legs.map(l => {
                    const g = l.greeks || {};
                    const delta = parseFloat(g.pos_delta || (l.action === 'SELL' ? -0.5 : 0.5) * (l.type === 'CE' ? 1 : -1));
                    const theta = parseFloat(g.pos_theta || (l.entry * 0.05 * l.qty));
                    const gamma = parseFloat(g.pos_gamma || 0.0012);
                    const vega = parseFloat(g.pos_vega || (l.entry * 0.02 * l.qty));
                    const iv = parseFloat(g.iv || 14.5);

                    totalDelta += delta;
                    totalTheta += theta;
                    totalGamma += gamma;
                    totalVega += vega;
                    sumIv += iv;
                    legCount++;

                    return `
                    <tr style="border-bottom: 1px solid #f1f5f9; font-size: 11px;">
                        <td style="padding: 6px 4px; font-weight: 700;">${l.symbol}</td>
                        <td style="padding: 6px 4px; font-family: monospace;">${iv.toFixed(1)}%</td>
                        <td style="padding: 6px 4px; font-family: monospace; font-weight: 700; color: ${delta >= 0 ? '#16a34a' : '#dc2626'};">${delta >= 0 ? '+' : ''}${delta.toFixed(2)}</td>
                        <td style="padding: 6px 4px; font-family: monospace; color: #16a34a;">+₹${Math.round(theta)}</td>
                        <td style="padding: 6px 4px; font-family: monospace;">${gamma.toFixed(4)}</td>
                        <td style="padding: 6px 4px; font-family: monospace; color: #0284c7;">₹${Math.round(vega)}</td>
                    </tr>`;
                }).join('');

                const avgIv = legCount > 0 ? (sumIv / legCount) : 0;
                const greeksFooterHtml = legCount > 0 ? `
                    <tfoot>
                        <tr style="background: #f1f5f9; border-top: 2px solid #cbd5e1; font-size: 11px; font-weight: 800;">
                            <td style="padding: 7px 4px; color: #0f172a;">TOTAL / NET</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: #64748b;">${avgIv.toFixed(1)}% (Avg)</td>
                            <td style="padding: 7px 4px; font-family: monospace; font-weight: 900; color: ${totalDelta >= 0 ? '#16a34a' : '#dc2626'};">${totalDelta >= 0 ? '+' : ''}${totalDelta.toFixed(2)}</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: ${totalTheta >= 0 ? '#16a34a' : '#dc2626'};">${totalTheta >= 0 ? '+' : ''}₹${Math.round(totalTheta).toLocaleString('en-IN')}</td>
                            <td style="padding: 7px 4px; font-family: monospace;">${totalGamma.toFixed(4)}</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: #0284c7;">₹${Math.round(totalVega).toLocaleString('en-IN')}</td>
                        </tr>
                    </tfoot>` : '';

                const greeksTableHtml = `
                <div style="overflow-x: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 12px; font-weight: 800; color: #1e293b;">📊 Strategy Greeks Breakdown</span>
                        <div style="font-size: 10px; font-weight: 700; color: #64748b;">Greeks (₹/lot)</div>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: #f8fafc; color: #475569; font-size: 10px; text-transform: uppercase; font-weight: 800; border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 6px 4px;">Option Leg</th>
                                <th style="padding: 6px 4px;">IV</th>
                                <th style="padding: 6px 4px;">Delta</th>
                                <th style="padding: 6px 4px;">Theta (₹/d)</th>
                                <th style="padding: 6px 4px;">Gamma</th>
                                <th style="padding: 6px 4px;">Vega (₹/1%)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${greeksRows || '<tr><td colspan="6" style="padding: 12px; text-align: center; color: #94a3b8;">No open legs available</td></tr>'}
                        </tbody>
                        ${greeksFooterHtml}
                    </table>
                </div>`;

                // Render Subtab 3: PnL Table with Totals
                let totalLegQty = 0, totalLegPnl = 0;
                const pnlRows = metrics.legs.map(l => {
                    const legPnl = (l.entry && l.ltp) ? (l.action === 'SELL' ? (l.entry - l.ltp) * l.qty : (l.ltp - l.entry) * l.qty) : 0;
                    totalLegQty += l.qty;
                    totalLegPnl += legPnl;

                    return `
                    <tr style="border-bottom: 1px solid #f1f5f9; font-size: 11px;">
                        <td style="padding: 6px 4px; font-weight: 700;">${l.symbol}</td>
                        <td style="padding: 6px 4px;"><span class="${l.action === 'SELL' ? 'opstra-badge-s' : 'opstra-badge-b'}">${l.action}</span></td>
                        <td style="padding: 6px 4px; font-family: monospace;">${l.qty}</td>
                        <td style="padding: 6px 4px; font-family: monospace;">₹${l.entry.toFixed(2)}</td>
                        <td style="padding: 6px 4px; font-family: monospace; font-weight: 700;">₹${l.ltp.toFixed(2)}</td>
                        <td style="padding: 6px 4px; font-family: monospace; font-weight: 800;" class="${getPnlClass(legPnl)}">${formatPnl(legPnl)}</td>
                    </tr>`;
                }).join('');

                const pnlFooterHtml = metrics.legs.length > 0 ? `
                    <tfoot>
                        <tr style="background: #f1f5f9; border-top: 2px solid #cbd5e1; font-size: 11px; font-weight: 800;">
                            <td colspan="2" style="padding: 7px 4px; color: #0f172a;">TOTAL</td>
                            <td style="padding: 7px 4px; font-family: monospace;">${totalLegQty}</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: #64748b;">--</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: #64748b;">--</td>
                            <td style="padding: 7px 4px; font-family: monospace; font-size: 12px; font-weight: 900;" class="${getPnlClass(pnl)}">${formatPnl(pnl)}</td>
                        </tr>
                    </tfoot>` : '';

                const pnlTableHtml = `
                <div style="overflow-x: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 12px; font-weight: 800; color: #1e293b;">💰 Position-wise P&amp;L Ledger</span>
                        <span style="font-size: 12px; font-weight: 800;" class="${getPnlClass(pnl)}">Total: ${formatPnl(pnl)}</span>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: #f8fafc; color: #475569; font-size: 10px; text-transform: uppercase; font-weight: 800; border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 6px 4px;">Symbol</th>
                                <th style="padding: 6px 4px;">Action</th>
                                <th style="padding: 6px 4px;">Qty</th>
                                <th style="padding: 6px 4px;">Entry Price</th>
                                <th style="padding: 6px 4px;">Current LTP</th>
                                <th style="padding: 6px 4px;">Leg P&amp;L</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pnlRows || '<tr><td colspan="6" style="padding: 12px; text-align: center; color: #94a3b8;">No positions active</td></tr>'}
                        </tbody>
                        ${pnlFooterHtml}
                    </table>
                </div>`;

                return `
                <div class="opstra-strat-card ${isActive ? 'active-strat' : 'inactive-strat'}" data-strat-id="${s.id}">
                    <!-- Card Top Header Row -->
                    <div class="opstra-card-header-row" onclick="toggleStrategyCard('${s.id}')">
                        <div onclick="event.stopPropagation()">
                            <input type="checkbox" class="opstra-card-chk" style="cursor: pointer; width: 15px; height: 15px;">
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-weight: 800; font-size: 13px; color: #0f172a;">${s.index_name} ${formatStrategyExpiry(s)}</span>
                            <span style="font-size: 10px; color: #64748b;">${s.product || 'NRML'} • ${totalLots} Lot${totalLots > 1 ? 's' : ''} (${s.quantity || lotSize} Qty)</span>
                        </div>
                        <div>
                            <span class="opstra-header-spot" style="font-weight: 800; font-size: 12px; font-family: monospace; color: #0f172a;">₹${spotLtp.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
                            <span style="font-size: 10px; font-weight: 700; color: ${parseFloat(spotDiffPct) >= 0 ? '#16a34a' : '#dc2626'}; font-family: monospace;">(${spotDiffSign}${spotDiffPct}%)</span>
                        </div>
                        <div>
                            <span style="font-weight: 700; font-size: 13px; color: #334155;">${s.name || 'Positional Strangle'}</span>
                        </div>
                        <div style="text-align: center;">
                            <span class="opstra-status-dot ${isActive ? 'active' : 'inactive'}" title="${isActive ? 'Strategy Active & Running' : 'Strategy Inactive'}"></span>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 14px; font-weight: 800; font-family: 'JetBrains Mono', monospace;" class="opstra-header-pnl ${getPnlClass(pnl)}">${formatPnl(pnl)}</span>
                        </div>
                        <div style="text-align: right;">
                            <span id="stratCardChevron_${s.id}" class="strat-card-chevron ${isCollapsed ? 'collapsed' : ''}">▼</span>
                        </div>
                    </div>

                    <!-- Collapsible Dropdown Panel -->
                    <div id="stratCardBody_${s.id}" class="opstra-dropdown-panel" style="display: ${isCollapsed ? 'none' : 'block'};">
                        <div class="opstra-panel-grid">
                            <!-- Left Column: Positions & Key Opstra Metrics -->
                            <div class="opstra-left-col">
                                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.5px;">
                                    Strategy Positions
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    ${legsHtml || '<div style="font-size: 11px; color: #94a3b8; font-style: italic;">No option legs calculated yet. Click 🔍 Calc Strikes below.</div>'}
                                </div>
                                ${metricsTableHtml}
                            </div>

                            <!-- Right Column: 4 Subtabs (Payoff Chart, Greeks, PnL, Edit) -->
                            <div>
                                <div class="opstra-subtabs-nav" id="opstraSubtabsNav_${s.id}">
                                    <button type="button" class="opstra-subtab-btn ${currentSubtab === 'PAYOFF' ? 'active' : ''}" data-tab="PAYOFF" onclick="switchOpstraSubtab('${s.id}', 'PAYOFF')">
                                        📈 Payoff Chart
                                    </button>
                                    <button type="button" class="opstra-subtab-btn ${currentSubtab === 'GREEKS' ? 'active' : ''}" data-tab="GREEKS" onclick="switchOpstraSubtab('${s.id}', 'GREEKS')">
                                        📊 Greeks
                                    </button>
                                    <button type="button" class="opstra-subtab-btn ${currentSubtab === 'PNL' ? 'active' : ''}" data-tab="PNL" onclick="switchOpstraSubtab('${s.id}', 'PNL')">
                                        💰 P&amp;L
                                    </button>
                                    <button type="button" class="opstra-subtab-btn ${currentSubtab === 'EDIT' ? 'active' : ''}" data-tab="EDIT" onclick="switchOpstraSubtab('${s.id}', 'EDIT')">
                                        ✏️ Edit Strategy
                                    </button>
                                </div>

                                <!-- Subtab 1: Payoff Chart -->
                                <div id="opstraPane_payoff_${s.id}" style="display: ${currentSubtab === 'PAYOFF' ? 'block' : 'none'};">
                                    <div style="height: 280px; width: 100%; position: relative;">
                                        <canvas id="opstraPayoffCanvas_${s.id}"></canvas>
                                    </div>
                                </div>

                                <!-- Subtab 2: Greeks -->
                                <div id="opstraPane_greeks_${s.id}" style="display: ${currentSubtab === 'GREEKS' ? 'block' : 'none'};">
                                    ${greeksTableHtml}
                                </div>

                                <!-- Subtab 3: PnL -->
                                <div id="opstraPane_pnl_${s.id}" style="display: ${currentSubtab === 'PNL' ? 'block' : 'none'};">
                                    ${pnlTableHtml}
                                </div>

                                <!-- Subtab 4: Edit Strategy -->
                                <div id="opstraPane_edit_${s.id}" style="display: ${currentSubtab === 'EDIT' ? 'block' : 'none'};">
                                    ${buildPosInlineEditPanel(s)}
                                </div>
                            </div>
                        </div>

                        <!-- Bottom Action Buttons Bar -->
                        <div class="opstra-bottom-actions">
                            <button onclick="togglePosStrategy('${s.id}')" class="btn-opstra ${isActive ? 'btn-opstra-danger' : 'btn-opstra-primary'}">
                                ${isActive ? '⏹️ Stop Strategy' : '▶️ Start Strategy'}
                            </button>
                            <button onclick="calculatePosStrikesFor('${s.id}')" class="btn-opstra btn-opstra-secondary" title="Recalculate strikes">
                                🔍 Calc Strikes
                            </button>
                            <button onclick="squareoffPosStrategy('${s.id}')" class="btn-opstra btn-opstra-danger" title="Square off open legs">
                                ⚡ Square Off / Exit
                            </button>
                            <button onclick="switchOpstraSubtab('${s.id}', 'EDIT')" class="btn-opstra btn-opstra-secondary">
                                ✏️ Edit
                            </button>
                            <button onclick="deletePosStrategy('${s.id}')" class="btn-opstra btn-opstra-secondary" style="color: #dc2626;" title="Delete Strategy">
                                🗑️ Delete
                            </button>
                        </div>
                    </div>
                </div>`;
            }).join('');

            // Render Opstra Top Filter Bar + Strategy Cards
            container.innerHTML = `
                <div class="opstra-filter-bar" id="posFilterBar">
                    <div class="opstra-bulk-links">
                        <span class="link-btn" onclick="selectAllCards('POS')">SELECT ALL</span>
                        <span class="link-btn" onclick="expandAllCards('POS')">EXPAND ALL</span>
                        <span class="link-btn" onclick="collapseAllCards('POS')">COLLAPSE ALL</span>
                    </div>
                    <div class="opstra-pill-group">
                        <button type="button" class="opstra-pill-btn ${posFilterInstrumentState === 'ALL' ? 'active' : ''}" data-inst="ALL" onclick="setPosFilterInstrument('ALL')">ALL</button>
                        <button type="button" class="opstra-pill-btn ${posFilterInstrumentState === 'BANKNIFTY' ? 'active' : ''}" data-inst="BANKNIFTY" onclick="setPosFilterInstrument('BANKNIFTY')">BANKNIFTY</button>
                        <button type="button" class="opstra-pill-btn ${posFilterInstrumentState === 'NIFTY' ? 'active' : ''}" data-inst="NIFTY" onclick="setPosFilterInstrument('NIFTY')">NIFTY</button>
                        <button type="button" class="opstra-pill-btn ${posFilterInstrumentState === 'SENSEX' ? 'active' : ''}" data-inst="SENSEX" onclick="setPosFilterInstrument('SENSEX')">SENSEX</button>
                        <button type="button" class="opstra-pill-btn ${posFilterInstrumentState === 'FINNIFTY' ? 'active' : ''}" data-inst="FINNIFTY" onclick="setPosFilterInstrument('FINNIFTY')">FINNIFTY</button>
                        <button type="button" class="opstra-pill-btn ${posFilterInstrumentState === 'MIDCPNIFTY' ? 'active' : ''}" data-inst="MIDCPNIFTY" onclick="setPosFilterInstrument('MIDCPNIFTY')">MIDCPNIFTY</button>
                    </div>
                    <div style="font-size: 13px; font-weight: 800; font-family: monospace;">
                        <span style="color: #64748b; font-size: 11px; font-weight: 700; font-family: sans-serif;">Total PNL: </span>
                        <span class="opstra-total-pnl-val ${getPnlClass(totalPosPnl)}">${formatPnl(totalPosPnl)}</span>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${cardsHtml}
                </div>
            `;

            // Initialize payoff charts on expanded cards
            setTimeout(() => {
                filteredStrats.forEach(s => {
                    if (!isStrategyCardCollapsed(s.id) && getOpstraSubtab(s.id) === 'PAYOFF') {
                        renderOpstraPayoffChart(s.id, s);
                    }
                });
            }, 100);
        }

        function togglePosTslInput() {
            const enabled = document.getElementById('posEnableTsl').checked;
            document.getElementById('posTslPointsGroup').style.display = enabled ? 'block' : 'none';
        }

        async function openNewPosStrategyForm() {
            toggleCardCollapse('posStrategyFormCollapseContent', 'posStrategyFormChevron', true);
            switchMainTab('tabPosStrangle');
            document.getElementById('posFormCardTitle').textContent = '⚙️ Create Positional Strategy';
            document.getElementById('posStratId').value = '';
            document.getElementById('posIndexName').value = 'NIFTY';
            await onPosIndexChange();
            autoSuggestPosName(true);
            document.getElementById('posCePremium').value = 80;
            document.getElementById('posPePremium').value = 80;
            document.getElementById('posEntryAction').value = 'SELL';
            document.getElementById('posProduct').value = 'NRML';
            document.getElementById('posCeSlPercent').value = 50;
            document.getElementById('posPeSlPercent').value = 50;
            document.getElementById('posTpPercent').value = 70;
            document.getElementById('posEnableTsl').checked = false;
            document.getElementById('posTslPoints').value = 10;
            togglePosTslInput();
            document.getElementById('posReentryCount').value = 1;
            document.getElementById('posStartTime').value = '15:00:00';
            document.getElementById('posMorningSlTime').value = '09:17:00';
            document.getElementById('posEndTime').value = '15:15:00';
            document.getElementById('posStrategyFormCard').scrollIntoView({ behavior: 'smooth' });
        }

        function editPosStrategy(stratId) {
            toggleStrategyInlineEdit('POS', stratId);
        }

        function cancelPosEditForm() {
            openNewPosStrategyForm();
        }

        if (document.getElementById('posQuantity')) {
            document.getElementById('posQuantity').addEventListener('blur', (e) => {
                const idx = (document.getElementById('posIndexName') ? document.getElementById('posIndexName').value : 'NIFTY');
                const lot = getBrokerLotSize(idx);
                const current = parseInt(e.target.value) || lot;
                const snapped = Math.max(lot, Math.round(current / lot) * lot);
                e.target.value = snapped;
            });
        }

        if (document.getElementById('posExpirySelect')) {
            document.getElementById('posExpirySelect').addEventListener('change', () => autoSuggestPosName());
        }

        if (document.getElementById('posStartTime')) {
            document.getElementById('posStartTime').addEventListener('change', () => autoSuggestPosName());
            document.getElementById('posStartTime').addEventListener('input', () => autoSuggestPosName());
        }

        if (document.getElementById('posCePremium')) {
            document.getElementById('posCePremium').addEventListener('input', () => autoSuggestPosName());
            document.getElementById('posCePremium').addEventListener('change', () => autoSuggestPosName());
        }
        if (document.getElementById('posPePremium')) {
            document.getElementById('posPePremium').addEventListener('input', () => autoSuggestPosName());
            document.getElementById('posPePremium').addEventListener('change', () => autoSuggestPosName());
        }

        async function savePosStrangleConfig(e) {
            if (e) e.preventDefault();

            const nameEl = document.getElementById('posStratName');
            const indexEl = document.getElementById('posIndexName');
            const expiryEl = document.getElementById('posExpirySelect');
            const cePremEl = document.getElementById('posCePremium');
            const pePremEl = document.getElementById('posPePremium');
            const actionEl = document.getElementById('posEntryAction');
            const productEl = document.getElementById('posProduct');
            const ceSlEl = document.getElementById('posCeSlPercent');
            const peSlEl = document.getElementById('posPeSlPercent');
            const tpEl = document.getElementById('posTpPercent');
            const reentryEl = document.getElementById('posReentryCount');
            const qtyEl = document.getElementById('posQuantity');
            const startTimeEl = document.getElementById('posStartTime');
            const morningSlEl = document.getElementById('posMorningSlTime');
            const endTimeEl = document.getElementById('posEndTime');

            const stratName = (nameEl ? nameEl.value : '').trim() || 'Positional Strangle';
            const indexName = indexEl ? indexEl.value : 'NIFTY';
            const expiryVal = expiryEl ? expiryEl.value : '';

            if (!expiryVal) {
                toast('Please select an expiry date before saving', true);
                return;
            }

            const entryTime = ensureHHMMSS((startTimeEl ? startTimeEl.value : '15:00:00').trim());
            const morningSlTime = ensureHHMMSS((morningSlEl ? morningSlEl.value : '09:17:00').trim());
            const exitTime = ensureHHMMSS((endTimeEl ? endTimeEl.value : '15:15:00').trim());
            const lot = getBrokerLotSize(indexName);

            const payload = {
                id: (document.getElementById('posStratId') ? document.getElementById('posStratId').value : '') || undefined,
                name: stratName,
                index_name: indexName,
                expiry: expiryVal,
                ce_premium: parseFloat(cePremEl ? cePremEl.value : 80) || 80,
                pe_premium: parseFloat(pePremEl ? pePremEl.value : 80) || 80,
                entry_action: actionEl ? actionEl.value : 'SELL',
                product: productEl ? productEl.value : 'NRML',
                ce_sl_percent: parseFloat(ceSlEl ? ceSlEl.value : 50) || 50,
                pe_sl_percent: parseFloat(peSlEl ? peSlEl.value : 50) || 50,
                sl_percent: parseFloat(ceSlEl ? ceSlEl.value : 50) || 50,
                tp_percent: parseFloat(tpEl ? tpEl.value : 70) || 70,
                enable_tsl: document.getElementById('posEnableTsl').checked,
                tsl_points: parseFloat(document.getElementById('posTslPoints').value) || 10,
                reentry_count: parseInt(reentryEl ? reentryEl.value : 1) || 0,
                quantity: parseInt(qtyEl ? qtyEl.value : lot) || lot,
                entry_time: entryTime,
                morning_sl_time: morningSlTime,
                exit_time: exitTime
            };

            try {
                const res = await api('/api/pos_strangle/strategies', 'POST', payload);
                if (res.status === 'ok') {
                    toast('✅ Positional Strategy Saved Successfully');
                    await fetchPosStrangleStatus();
                    openNewPosStrategyForm();
                } else {
                    toast('❌ Error saving strategy: ' + (res.message || 'Unknown error'), true);
                }
            } catch (err) {
                console.error("Save strategy error:", err);
                toast('❌ Network or Server error while saving', true);
            }
        }

        let posPnlSummaryData = { records_count: 0, history: [] };

        async function fetchPosPnlSummary() {
            try {
                const res = await api('/api/pos_strangle/pnl/summary');
                if (res.status === 'ok') {
                    posPnlSummaryData = res;
                    renderPosHistoryTable(res.history || []);
                    const badge = document.getElementById('posJournalTradesBadge');
                    if (badge) badge.textContent = `${res.records_count || 0} Trade${res.records_count === 1 ? '' : 's'} in Journal`;
                }
            } catch (e) {
                // Polling error
            }
        }

        async function fetchPosPendingOrders() {
            try {
                const res = await api('/api/pos_strangle/pending_orders');
                if (res.status === 'ok') {
                    const badge = document.getElementById('posPendingOrdersBadge');
                    if (badge) {
                        const count = res.orders_count || 0;
                        badge.textContent = `💾 ${count} Local Order${count === 1 ? '' : 's'} Tracked`;
                        badge.style.background = count > 0 ? '#fef3c7' : '#f1f5f9';
                        badge.style.color = count > 0 ? '#92400e' : '#64748b';
                        badge.style.borderColor = count > 0 ? '#fde68a' : '#e2e8f0';
                    }
                }
            } catch (e) {
                // Polling error
            }
        }

        function togglePosHistoryTable() {
            const container = document.getElementById('posHistoryContainer');
            if (container) {
                const isHidden = container.style.display === 'none';
                container.style.display = isHidden ? 'block' : 'none';
                if (isHidden) fetchPosPnlSummary();
            }
        }

        function renderPosHistoryTable(records) {
            const tbody = document.getElementById('posHistoryBody');
            if (!tbody) return;
            if (!records || records.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="12" style="text-align: center; color: var(--text-muted); padding: 16px;">
                            No positional trade records in pos_strategy_PnL.csv yet. Records are automatically added upon trade entry and exit.
                        </td>
                    </tr>`;
                return;
            }

            tbody.innerHTML = records.map(r => {
                const dayPnl = parseFloat(r.Day_PnL !== undefined ? r.Day_PnL : (r.Total_PnL || 0));
                const cumPnl = parseFloat(r.Cumulative_PnL || 0);
                const sname = r.Strategy_Name || 'Positional Strategy';
                const inst = r.Instrument || '--';
                const lot = r.Lot_Size || '--';
                const leg = r.Leg || (r.CE_Symbol && r.CE_Symbol !== '--' ? 'CE' : (r.PE_Symbol && r.PE_Symbol !== '--' ? 'PE' : '--'));
                const sym = r.Symbol || r.CE_Symbol || r.PE_Symbol || '--';

                const expEntry = r.Expected_Entry_Price && r.Expected_Entry_Price !== '--' && parseFloat(r.Expected_Entry_Price) > 0 ? `₹${parseFloat(r.Expected_Entry_Price).toFixed(2)}` : '--';
                const actEntry = r.Actual_Entry_Price && r.Actual_Entry_Price !== '--' && parseFloat(r.Actual_Entry_Price) > 0 ? `₹${parseFloat(r.Actual_Entry_Price).toFixed(2)}` : (r.CE_Entry_Price || r.PE_Entry_Price || '--');

                const expExit = r.Expected_Exit_Price && r.Expected_Exit_Price !== '--' && parseFloat(r.Expected_Exit_Price) > 0 ? `₹${parseFloat(r.Expected_Exit_Price).toFixed(2)}` : '--';
                const actExit = r.Actual_Exit_Price && r.Actual_Exit_Price !== '--' && parseFloat(r.Actual_Exit_Price) > 0 ? `₹${parseFloat(r.Actual_Exit_Price).toFixed(2)}` : (r.CE_Exit_Price || r.PE_Exit_Price || '--');

                const totSlipInr = parseFloat(r.Total_Slippage_INR || 0);
                const totSlipPts = (parseFloat(r.Entry_Slippage_Pts || 0) + parseFloat(r.Exit_Slippage_Pts || 0));
                const isFavorable = totSlipInr >= 0;
                const slipBadge = (r.Total_Slippage_INR !== undefined && (totSlipPts !== 0 || totSlipInr !== 0))
                    ? `<span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 11px; color: ${isFavorable ? '#16a34a' : '#dc2626'};">${isFavorable ? '+' : ''}₹${totSlipInr.toFixed(2)} (${isFavorable ? '+' : ''}${totSlipPts.toFixed(2)} pts)</span>`
                    : '<span style="color: var(--text-muted); font-size: 11px;">0.00 pts</span>';

                const isClosed = r.Status === 'CLOSED';

                return `
                <tr>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;">#${r.Serial_No}</td>
                    <td style="font-weight: 600; color: var(--text-primary); font-family: monospace; font-size: 11px;">
                        ${r.Date}<br><span style="font-size: 10px; color: var(--text-muted);">${r.Time || r.Entry_Time || '--'}</span>
                    </td>
                    <td style="font-weight: 700; color: var(--accent-light);">${sname}</td>
                    <td>
                        <span class="badge-tag badge-nifty" style="font-size: 11px;">${inst}</span>
                        ${leg !== '--' ? `<span class="badge-tag" style="font-weight: 700; font-size: 10px; margin-left: 4px;">${leg}</span>` : ''}
                        <br><span style="font-size: 10px; color: var(--text-muted); font-family: monospace;">${sym}</span>
                    </td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 600;">${lot}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">
                        <span style="color: var(--text-muted);">Exp:</span> ${expEntry}<br><b>Fill:</b> ${actEntry}
                    </td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">
                        <span style="color: var(--text-muted);">Trig:</span> ${expExit}<br><b>Fill:</b> ${actExit}
                    </td>
                    <td>${slipBadge}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800;" class="${getPnlClass(dayPnl)}">${formatPnl(dayPnl)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800;" class="${getPnlClass(cumPnl)}">${formatPnl(cumPnl)}</td>
                    <td><span style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">${r.Exit_Reason || r.Exit_Date || '--'}</span></td>
                    <td><span class="badge-tag ${isClosed ? 'badge-complete' : 'badge-active'}">${r.Status || 'OPEN'}</span></td>
                </tr>`;
            }).join('');
        }

        function downloadPosPnlCsv() {
            toast('📥 Downloading pos_strategy_PnL.csv...');
            window.location.href = '/api/pos_strangle/pnl/download';
        }

        async function togglePosStrategy(stratId) {
            const strat = loadedPosStrategies.find(s => s.id === stratId);
            if (!strat) return;
            const newActive = !strat.active;
            const res = await api(`/api/pos_strangle/strategies/${stratId}/toggle`, 'POST', { active: newActive });
            if (res.status === 'ok') {
                toast(newActive ? `Started '${strat.name}'` : `Stopped '${strat.name}'`);
                fetchPosStrangleStatus();
            }
        }

        async function calculatePosStrikesFor(stratId) {
            toast('⏳ Calculating strikes for Positional Strategy...');
            const res = await api(`/api/pos_strangle/strategies/${stratId}/calculate`, 'POST');
            if (res.status === 'ok') {
                toast('✅ ' + (res.message || 'Strikes calculated successfully'));
                fetchPosStrangleStatus();
            } else {
                toast('❌ ' + (res.message || 'Calculation failed'), true);
            }
        }

        async function squareoffPosStrategy(stratId) {
            const strat = loadedPosStrategies.find(s => s.id === stratId);
            if (!confirm(`Are you sure you want to square off '${strat ? strat.name : stratId}'?`)) return;
            toast('⚡ Squaring off Positional Strategy...');
            const res = await api(`/api/pos_strangle/strategies/${stratId}/squareoff`, 'POST');
            if (res.status === 'ok') {
                toast('✅ ' + (res.message || 'Square off complete'));
                fetchPosStrangleStatus();
            } else {
                toast('❌ ' + (res.message || 'Square off failed'), true);
            }
        }

        async function deletePosStrategy(stratId) {
            const strat = loadedPosStrategies.find(s => s.id === stratId);
            if (!confirm(`Delete positional strategy '${strat ? strat.name : stratId}'?`)) return;
            const res = await api(`/api/pos_strangle/strategies/${stratId}`, 'DELETE');
            if (res.status === 'ok') {
                toast('Strategy Deleted');
                fetchPosStrangleStatus();
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // STRADDLE TOTAL SL STRATEGY (straddle_total_sl.py Bridge)
        // ═══════════════════════════════════════════════════════════════

        let loadedStraddleStrategies = [];
        let straddlePnlSummaryData = { records_count: 0, history: [] };

        function onStraddleIndexChange(resetToOneLot = true) {
            const idx = document.getElementById('straddleIndexName').value || 'NIFTY';
            loadStraddleExpiries();
            const lot = getBrokerLotSize(idx);
            const qInput = document.getElementById('straddleQuantity');
            if (qInput) {
                if (resetToOneLot) {
                    qInput.value = lot;
                } else {
                    const current = parseInt(qInput.value) || lot;
                    const snapped = Math.max(lot, Math.round(current / lot) * lot);
                    qInput.value = snapped;
                }
                qInput.step = lot;
                qInput.min = lot;
            }
            const lbl = document.getElementById('lblStraddleQuantity');
            if (lbl) lbl.textContent = `Quantity (Multiple of Lot Size: ${lot} for ${idx})`;
            autoSuggestStraddleName();
        }

        let currentStraddleFutures = [];

        async function loadStraddleExpiries(preferredExpiry, preferredUnderlying) {
            const idx = document.getElementById('straddleIndexName').value || 'NIFTY';
            const data = await api(`/api/expiries?index=${idx}`);
            const select = document.getElementById('straddleExpirySelect');
            const uSelect = document.getElementById('straddleUnderlyingType');

            const dates = Array.isArray(data) ? data : (data?.dates || []);
            const monthlyDates = (!Array.isArray(data) && data?.monthly_expiries) ? data.monthly_expiries : [];
            const curMonthExp = (!Array.isArray(data) && data?.current_month_expiry) ? data.current_month_expiry : (monthlyDates[0] || dates[0] || '');
            const nextMonthExp = (!Array.isArray(data) && data?.next_month_expiry) ? data.next_month_expiry : (monthlyDates[1] || curMonthExp);
            currentStraddleFutures = (!Array.isArray(data) && data?.futures) ? data.futures : [];

            // 1. Populate Underlying Calculation Basis (Cash vs Futures)
            if (uSelect) {
                let uHtml = `<option value="CASH">💵 Cash Spot (Index LTP)</option>`;
                if (currentStraddleFutures && currentStraddleFutures.length > 0) {
                    currentStraddleFutures.forEach((f, idx) => {
                        const futKey = f.key || `FUT_${idx + 1}`;
                        const label = idx === 0 ? `📈 Current Month Future (${f.expiry})` : (idx === 1 ? `📅 Next Month Future (${f.expiry})` : `🗓️ Far Month Future (${f.expiry})`);
                        uHtml += `<option value="${futKey}">${label} - ${f.symbol}</option>`;
                    });
                } else {
                    uHtml += `<option value="CURRENT_FUT">📈 Current Month Future</option>`;
                    uHtml += `<option value="NEXT_FUT">📅 Next Month Future</option>`;
                    uHtml += `<option value="FAR_FUT">🗓️ Far Month Future</option>`;
                }
                uSelect.innerHTML = uHtml;
                if (preferredUnderlying) {
                    uSelect.value = preferredUnderlying;
                }
            }

            // 2. Populate Option Expiries
            if (select) {
                if (dates && dates.length > 0) {
                    let optionsHtml = '';
                    optionsHtml += `<option value="CURRENT_MONTH">⚡ Current Month Expiry (${curMonthExp})</option>`;
                    if (nextMonthExp && nextMonthExp !== curMonthExp) {
                        optionsHtml += `<option value="NEXT_MONTH">📅 Next Month Expiry (${nextMonthExp})</option>`;
                    }
                    optionsHtml += `<option value="CURRENT">⚡ Nearest Weekly Expiry (${dates[0]})</option>`;
                    if (dates.length > 1) {
                        optionsHtml += `<option value="NEXT">📅 Next Weekly Expiry (${dates[1]})</option>`;
                    }

                    if (monthlyDates.length > 0) {
                        optionsHtml += `<optgroup label="Monthly Expiries (Last Expiry of Month)">`;
                        monthlyDates.forEach(d => {
                            optionsHtml += `<option value="${d}">${d} (Monthly)</option>`;
                        });
                        optionsHtml += `</optgroup>`;
                    }

                    optionsHtml += `<optgroup label="All Upcoming Expiry Dates">`;
                    dates.forEach(d => {
                        optionsHtml += `<option value="${d}">${d}</option>`;
                    });
                    optionsHtml += `</optgroup>`;

                    select.innerHTML = optionsHtml;
                    if (preferredExpiry && (preferredExpiry === 'CURRENT' || preferredExpiry === 'NEXT' || preferredExpiry === 'CURRENT_MONTH' || preferredExpiry === 'NEXT_MONTH' || dates.includes(preferredExpiry))) {
                        select.value = preferredExpiry;
                    } else {
                        select.value = 'CURRENT_MONTH';
                    }
                } else {
                    select.innerHTML = `<option value="CURRENT_MONTH">Current Month Expiry</option><option value="CURRENT">Current Expiry</option><option value="NEXT">Next Expiry</option>`;
                }
            }
            fetchStraddleUnderlyingLtp();
        }

        let _straddleLtpFetchTimer = null;

        async function fetchStraddleUnderlyingLtp(isManualRefresh = false) {
            const idx = document.getElementById('straddleIndexName')?.value || 'NIFTY';
            const uType = document.getElementById('straddleUnderlyingType')?.value || 'CASH';
            const strikeMode = document.getElementById('straddleStrikeMode')?.value || 'ATM';
            const strikeMult = document.getElementById('straddleStrikeMultiple')?.value || '500';

            const priceEl = document.getElementById('straddleLiveUnderlyingPrice');
            const nameEl = document.getElementById('straddleLiveUnderlyingName');
            const atmEl = document.getElementById('straddleLiveCalculatedAtm');
            const hintEl = document.getElementById('straddleUnderlyingHint');
            const refreshBtn = document.getElementById('straddleLtpRefreshBtn');

            if (isManualRefresh && refreshBtn) {
                refreshBtn.textContent = '⏳ Fetching...';
                refreshBtn.disabled = true;
            }

            try {
                const res = await api(`/api/underlying_ltp?index=${encodeURIComponent(idx)}&underlying_type=${encodeURIComponent(uType)}&strike_mode=${encodeURIComponent(strikeMode)}&strike_multiple=${encodeURIComponent(strikeMult)}`);
                if (res && res.ltp !== undefined) {
                    const ltpVal = parseFloat(res.ltp || 0);
                    if (priceEl) {
                        priceEl.textContent = ltpVal > 0 ? `₹${ltpVal.toFixed(2)}` : '₹0.00 (Offline / Market Closed)';
                        priceEl.style.color = ltpVal > 0 ? '#0f172a' : '#64748b';
                    }
                    if (nameEl) {
                        nameEl.textContent = res.display_name ? `(${res.display_name})` : `(${res.symbol || idx})`;
                    }
                    if (atmEl) {
                        if (strikeMode === 'MANUAL') {
                            const manualVal = document.getElementById('straddleManualStrike')?.value || '--';
                            atmEl.textContent = `${manualVal} (Manual)`;
                        } else if (strikeMode === 'ROUND_OFF') {
                            atmEl.textContent = res.atm_strike > 0 ? `${res.atm_strike} (Round ${strikeMult})` : '--';
                        } else {
                            atmEl.textContent = res.atm_strike > 0 ? `${res.atm_strike} (ATM)` : '--';
                        }
                    }
                    if (hintEl) {
                        if (ltpVal > 0) {
                            hintEl.innerHTML = `Live <b>${res.display_name}</b> LTP: <b style="color: #0f172a;">₹${ltpVal.toFixed(2)}</b> &rarr; Calculated ATM Strike: <b style="color: #92400e;">${res.atm_strike}</b>`;
                        } else {
                            hintEl.textContent = `Calculates ATM strike based on ${res.display_name}`;
                        }
                    }
                }
            } catch (err) {
                console.warn('Could not fetch underlying LTP:', err);
                if (priceEl && priceEl.textContent === '₹--') {
                    priceEl.textContent = '₹--';
                }
            } finally {
                if (refreshBtn) {
                    refreshBtn.textContent = '🔄 Refresh LTP';
                    refreshBtn.disabled = false;
                }
            }
        }

        async function fetchStraddleStatus(force = false) {
            if (!force && document.getElementById('consoleView').style.display !== 'block') return;
            try {
                const res = await api('/api/straddle_total_sl/status');
                if (res.status === 'ok') {
                    loadedStraddleStrategies = res.strategies || [];
                    renderStraddleInstrumentGroups(loadedStraddleStrategies);
                    renderStraddleLogs(res.logs || []);
                }
                fetchStraddlePnlSummary();
                fetchStraddlePendingOrders();
                // Keep underlying LTP fresh if straddle tab is active
                if (document.getElementById('tabStraddleTotalSl')?.classList.contains('active')) {
                    fetchStraddleUnderlyingLtp();
                }
            } catch (e) {
                // Polling error
            }
        }

        function renderStraddleLogs(logs) {
            const term = document.getElementById('straddleLogsTerminal');
            if (logs && logs.length > 0) {
                term.innerHTML = logs.map(l => `<div class="log-line">${l}</div>`).join('');
                term.scrollTop = term.scrollHeight;
            }
            const lastSync = document.getElementById('straddleLastChecked');
            if (lastSync) lastSync.textContent = `Sync: ${new Date().toLocaleTimeString('en-IN')}`;
        }

        function getStraddleGreekToggles() {
            return {
                showTheta: localStorage.getItem('straddle_greek_theta') !== 'false',
                showVega: localStorage.getItem('straddle_greek_vega') !== 'false',
                showIv: localStorage.getItem('straddle_greek_iv') !== 'false',
                showPerLeg: localStorage.getItem('straddle_greek_perleg') !== 'false'
            };
        }

        function initStraddleGreekToggles() {
            const toggles = getStraddleGreekToggles();
            const elTheta = document.getElementById('toggleGreekTheta');
            const elVega = document.getElementById('toggleGreekVega');
            const elIv = document.getElementById('toggleGreekIv');
            const elPerLeg = document.getElementById('toggleGreekPerLeg');
            if (elTheta) elTheta.checked = toggles.showTheta;
            if (elVega) elVega.checked = toggles.showVega;
            if (elIv) elIv.checked = toggles.showIv;
            if (elPerLeg) elPerLeg.checked = toggles.showPerLeg;
        }

        function onStraddleGreekToggleChange() {
            const elTheta = document.getElementById('toggleGreekTheta');
            const elVega = document.getElementById('toggleGreekVega');
            const elIv = document.getElementById('toggleGreekIv');
            const elPerLeg = document.getElementById('toggleGreekPerLeg');
            if (elTheta) localStorage.setItem('straddle_greek_theta', elTheta.checked);
            if (elVega) localStorage.setItem('straddle_greek_vega', elVega.checked);
            if (elIv) localStorage.setItem('straddle_greek_iv', elIv.checked);
            if (elPerLeg) localStorage.setItem('straddle_greek_perleg', elPerLeg.checked);
            if (loadedStraddleStrategies && loadedStraddleStrategies.length > 0) {
                renderStraddleInstrumentGroups(loadedStraddleStrategies);
            }
        }

        function renderStraddleGreeksBoxHtml(s) {
            const g = s.greeks;
            if (!g || !g.legs || g.legs.length === 0) {
                return '';
            }

            const toggles = getStraddleGreekToggles();
            const netDeltaUnit = parseFloat(g.net_delta_unit !== undefined ? g.net_delta_unit : 0.0);
            const netDeltaShares = parseFloat(g.net_delta_shares !== undefined ? g.net_delta_shares : 0.0);
            const netTheta = parseFloat(g.net_theta !== undefined ? g.net_theta : 0.0);
            const netVega = parseFloat(g.net_vega !== undefined ? g.net_vega : 0.0);
            const avgIv = parseFloat(g.avg_iv !== undefined ? g.avg_iv : 0.0);
            const activeLegsCount = g.active_legs_count || g.legs.length;

            // Delta Neutrality Indicator Badge
            let deltaTagHtml = '';
            const absDelta = Math.abs(netDeltaUnit);
            if (absDelta <= 0.15) {
                deltaTagHtml = `<span style="background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px;">🟢 Delta Neutral</span>`;
            } else if (netDeltaUnit > 0.15) {
                deltaTagHtml = `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px;">🔵 Bullish +Δ Bias</span>`;
            } else {
                deltaTagHtml = `<span style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px;">🔴 Bearish -Δ Bias</span>`;
            }

            const deltaSign = netDeltaUnit >= 0 ? '+' : '';
            const deltaSharesSign = netDeltaShares >= 0 ? '+' : '';

            // Optional Greek Summary Cards (Toggled)
            const thetaCardHtml = toggles.showTheta ? `
                <div style="background: #ffffff; border: 1px solid #bbf7d0; border-radius: 4px; padding: 6px 8px; flex: 1; min-width: 95px;">
                    <div style="font-size: 9px; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">⏳ Daily Theta</div>
                    <div style="font-size: 11px; font-weight: 800; color: ${netTheta >= 0 ? '#15803d' : '#b91c1c'}; font-family: monospace; margin-top: 2px;">
                        ${netTheta >= 0 ? '+' : ''}₹${netTheta.toLocaleString('en-IN', { maximumFractionDigits: 1 })}/d
                    </div>
                </div>` : '';

            const vegaCardHtml = toggles.showVega ? `
                <div style="background: #ffffff; border: 1px solid #bae6fd; border-radius: 4px; padding: 6px 8px; flex: 1; min-width: 95px;">
                    <div style="font-size: 9px; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">🌊 Total Vega</div>
                    <div style="font-size: 11px; font-weight: 800; color: ${netVega >= 0 ? '#15803d' : '#0369a1'}; font-family: monospace; margin-top: 2px;">
                        ${netVega >= 0 ? '+' : ''}₹${netVega.toLocaleString('en-IN', { maximumFractionDigits: 1 })}/1%
                    </div>
                </div>` : '';

            const ivCardHtml = toggles.showIv ? `
                <div style="background: #ffffff; border: 1px solid #f0abfc; border-radius: 4px; padding: 6px 8px; flex: 0.8; min-width: 75px;">
                    <div style="font-size: 9px; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">📊 Avg IV</div>
                    <div style="font-size: 11px; font-weight: 800; color: #a21caf; font-family: monospace; margin-top: 2px;">
                        ${avgIv.toFixed(1)}%
                    </div>
                </div>` : '';

            // Per-Leg Breakdown List (if enabled)
            let perLegsListHtml = '';
            if (toggles.showPerLeg && g.legs && g.legs.length > 0) {
                const rows = g.legs.map(leg => {
                    const isShort = leg.action === 'SELL';
                    const actColor = isShort ? '#b91c1c' : '#15803d';
                    const legDelta = parseFloat(leg.pos_delta || 0.0);
                    const legTheta = parseFloat(leg.pos_theta || 0.0);
                    const legVega = parseFloat(leg.pos_vega || 0.0);
                    const legIv = parseFloat(leg.iv || 0.0);

                    return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-top: 1px dashed #e2e8f0; font-size: 10px; font-family: monospace;">
                        <div>
                            <span style="font-weight: 800; color: ${actColor};">${leg.action}</span>
                            <span style="font-weight: 700; color: var(--text-primary);">${leg.opt_type} ${leg.strike}</span>
                            <span style="color: var(--text-muted); font-size: 9px;">(${leg.quantity}q)</span>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <span title="Position Delta (Shares)">Δ <b style="color: ${legDelta >= 0 ? '#15803d' : '#b91c1c'};">${legDelta >= 0 ? '+' : ''}${legDelta.toFixed(1)}</b></span>
                            ${toggles.showTheta ? `<span title="Position Daily Theta (₹/day)" style="color: ${legTheta >= 0 ? '#15803d' : '#b91c1c'};">Θ <b>${legTheta >= 0 ? '+' : ''}₹${legTheta.toFixed(0)}</b></span>` : ''}
                            ${toggles.showVega ? `<span title="Position Vega (₹/1% IV)" style="color: #0369a1;">ν <b>${legVega >= 0 ? '+' : ''}${legVega.toFixed(0)}</b></span>` : ''}
                            ${toggles.showIv ? `<span title="Implied Volatility" style="color: #a21caf;">IV <b>${legIv.toFixed(1)}%</b></span>` : ''}
                        </div>
                    </div>`;
                }).join('');

                perLegsListHtml = `
                    <div style="margin-top: 6px; padding-top: 4px;">
                        <div style="font-size: 9px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">
                            Active Legs Greeks (${activeLegsCount} leg${activeLegsCount === 1 ? '' : 's'}):
                        </div>
                        ${rows}
                    </div>
                `;
            }

            return `
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: var(--radius-sm); padding: 8px 10px; margin-bottom: 12px; font-size: 11px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 13px;">📐</span>
                        <span style="font-weight: 800; color: #1e293b; font-size: 11px;">STRATEGY GREEKS (Full Setup)</span>
                    </div>
                    <div>
                        ${deltaTagHtml}
                    </div>
                </div>

                <!-- Greek Summary Cards Row -->
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <!-- Core Delta Card (Always On) -->
                    <div style="background: #ffffff; border: 1px solid #c7d2fe; border-radius: 4px; padding: 6px 8px; flex: 1.2; min-width: 110px;">
                        <div style="font-size: 9px; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">🎯 Net Delta</div>
                        <div style="font-size: 11px; font-weight: 800; color: ${absDelta <= 0.15 ? '#15803d' : (netDeltaUnit > 0 ? '#0369a1' : '#b91c1c')}; font-family: monospace; margin-top: 2px;">
                            ${deltaSign}${netDeltaUnit.toFixed(3)} <span style="font-size: 9px; font-weight: 600; color: var(--text-muted);">(${deltaSharesSign}${netDeltaShares.toFixed(1)} sh)</span>
                        </div>
                    </div>
                    ${thetaCardHtml}
                    ${vegaCardHtml}
                    ${ivCardHtml}
                </div>

                ${perLegsListHtml}
            </div>
            `;
        }

        function getAutomaticStraddleGroupName(s) {
            const stratType = (s.strategy_type || 'STRADDLE').toUpperCase();
            const legSel = (s.leg_selection || 'BOTH').toUpperCase();
            if (stratType === 'STRANGLE') {
                return 'Strangle';
            } else if (stratType === 'INDIVIDUAL_LEG' || legSel === 'CE_ONLY' || legSel === 'PE_ONLY') {
                return legSel === 'PE_ONLY' ? 'PE_Only' : 'CE_Only';
            } else {
                return 'Straddle';
            }
        }

        let straddleFilterState = {
            type: 'ALL',
            instrument: 'ALL',
            expiry: 'ALL'
        };

        function updateStraddleExpiryFilterOptions(strategies) {
            const expSelect = document.getElementById('straddleFilterExpiry');
            if (!expSelect) return;
            const currentSelected = expSelect.value || 'ALL';
            
            // Collect unique expiries
            const expiriesSet = new Set();
            (strategies || []).forEach(s => {
                const exp = s.expiry || s.resolved_expiry;
                if (exp && exp !== 'CURRENT' && exp !== 'NEXT') {
                    expiriesSet.add(exp);
                }
            });

            const sortedExpiries = Array.from(expiriesSet).sort();
            let optionsHtml = `<option value="ALL">All Expiries</option>`;
            sortedExpiries.forEach(exp => {
                optionsHtml += `<option value="${exp}" ${exp === currentSelected ? 'selected' : ''}>${exp}</option>`;
            });

            expSelect.innerHTML = optionsHtml;
        }

        function applyStraddleFilters() {
            const typeFilter = document.getElementById('straddleFilterType')?.value || 'ALL';
            const instFilter = document.getElementById('straddleFilterInstrument')?.value || 'ALL';
            const expFilter = document.getElementById('straddleFilterExpiry')?.value || 'ALL';

            straddleFilterState = {
                type: typeFilter,
                instrument: instFilter,
                expiry: expFilter
            };

            renderStraddleInstrumentGroups(loadedStraddleStrategies);
        }

        function resetStraddleFilters() {
            if (document.getElementById('straddleFilterType')) document.getElementById('straddleFilterType').value = 'ALL';
            if (document.getElementById('straddleFilterInstrument')) document.getElementById('straddleFilterInstrument').value = 'ALL';
            if (document.getElementById('straddleFilterExpiry')) document.getElementById('straddleFilterExpiry').value = 'ALL';

            straddleFilterState = {
                type: 'ALL',
                instrument: 'ALL',
                expiry: 'ALL'
            };

            renderStraddleInstrumentGroups(loadedStraddleStrategies);
        }

        let lastStraddleRenderSignature = '';

        function renderStraddleInstrumentGroups(strategies) {
            const container = document.getElementById('straddleInstrumentGroupsContainer');
            if (!container) return;

            if (inlineEditingStratIds.size > 0 && Array.from(inlineEditingStratIds).some(id => (strategies || []).some(s => s.id === id))) {
                return; // Pause re-rendering while user is editing an inline card in Tab 6
            }

            if (!strategies || strategies.length === 0) {
                lastStraddleRenderSignature = '';
                container.innerHTML = `
                    <div class="card" style="text-align: center; padding: 32px; color: var(--text-muted);">
                        <p style="font-size: 14px; margin-bottom: 8px;">No Straddle Total SL strategies created yet.</p>
                        <button onclick="openNewStraddleStrategyForm()" class="btn-primary" style="width: auto; padding: 6px 16px;">
                            ➕ Create Straddle Strategy
                        </button>
                    </div>`;
                return;
            }

            // Sync dynamic expiry filter options from loaded strategies
            updateStraddleExpiryFilterOptions(strategies);

            // Update Tab status badge with count of active straddles
            const activeCount = strategies.filter(s => s.active).length;
            const tabBadge = document.getElementById('straddleStatusBadge');
            if (tabBadge) {
                tabBadge.textContent = activeCount > 0 ? `${activeCount} Active` : `${strategies.length} Strats`;
                tabBadge.style.background = activeCount > 0 ? '#dcfce7' : '#e0f2fe';
                tabBadge.style.color = activeCount > 0 ? '#15803d' : '#0369a1';
            }

            // Calculate overall Portfolio PnL for top bar
            const totalStraddlePnl = strategies.reduce((acc, curr) => acc + (parseFloat(getStrategyPnl(curr)) || 0), 0);

            // Filter strategies based on Instrument pill
            const filteredStrategies = strategies.filter(s => {
                if (straddlePillFilterState !== 'ALL') {
                    return (s.index_name || '').toUpperCase() === straddlePillFilterState.toUpperCase();
                }
                return true;
            });

            // Sort: In-Action (active / green background) on TOP, Idle/Inactive below. Within each status group, NIFTY on top, BANKNIFTY below
            const getStraddleIndexOrder = (idx) => {
                const upper = (idx || '').toUpperCase();
                if (upper.includes('NIFTY') && !upper.includes('BANK')) return 1;
                if (upper.includes('BANK')) return 2;
                if (upper.includes('FIN')) return 3;
                if (upper.includes('MIDCP') || upper.includes('MID')) return 4;
                if (upper.includes('SENSEX')) return 5;
                return 10;
            };

            filteredStrategies.sort((a, b) => {
                // 1. Active (In Action / Green) on top, Idle/Inactive below
                const aActive = a.active ? 1 : 0;
                const bActive = b.active ? 1 : 0;
                if (aActive !== bActive) {
                    return bActive - aActive; // Active (1) first
                }
                // 2. Index priority: NIFTY on top (1), BANKNIFTY below (2), etc.
                const aIdx = getStraddleIndexOrder(a.index_name);
                const bIdx = getStraddleIndexOrder(b.index_name);
                if (aIdx !== bIdx) {
                    return aIdx - bIdx;
                }
                // 3. Alphabetical fallback
                return (a.name || '').localeCompare(b.name || '');
            });

            if (filteredStrategies.length === 0) {
                lastStraddleRenderSignature = '';
                container.innerHTML = `
                    <div class="opstra-filter-bar" id="straddleFilterBar">
                        <div class="opstra-bulk-links">
                            <span class="link-btn" onclick="selectAllCards('STRADDLE')">SELECT ALL</span>
                            <span class="link-btn" onclick="expandAllCards('STRADDLE')">EXPAND ALL</span>
                            <span class="link-btn" onclick="collapseAllCards('STRADDLE')">COLLAPSE ALL</span>
                        </div>
                        <div class="opstra-pill-group">
                            <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'ALL' ? 'active' : ''}" data-inst="ALL" onclick="setStraddlePillFilter('ALL')">ALL</button>
                            <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'BANKNIFTY' ? 'active' : ''}" data-inst="BANKNIFTY" onclick="setStraddlePillFilter('BANKNIFTY')">BANKNIFTY</button>
                            <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'NIFTY' ? 'active' : ''}" data-inst="NIFTY" onclick="setStraddlePillFilter('NIFTY')">NIFTY</button>
                            <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'SENSEX' ? 'active' : ''}" data-inst="SENSEX" onclick="setStraddlePillFilter('SENSEX')">SENSEX</button>
                            <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'FINNIFTY' ? 'active' : ''}" data-inst="FINNIFTY" onclick="setStraddlePillFilter('FINNIFTY')">FINNIFTY</button>
                            <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'MIDCPNIFTY' ? 'active' : ''}" data-inst="MIDCPNIFTY" onclick="setStraddlePillFilter('MIDCPNIFTY')">MIDCPNIFTY</button>
                        </div>
                        <div style="font-size: 13px; font-weight: 800; font-family: monospace;">
                            <span style="color: #64748b; font-size: 11px; font-weight: 700; font-family: sans-serif;">Total PNL: </span>
                            <span class="opstra-total-pnl-val ${getPnlClass(totalStraddlePnl)}">${formatPnl(totalStraddlePnl)}</span>
                        </div>
                    </div>
                    <div class="card" style="text-align: center; padding: 36px; color: var(--text-muted); background: #ffffff; border: 1px dashed var(--border-color); border-radius: 8px;">
                        <p style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">🔍 No strategies match the selected instrument</p>
                        <button onclick="setStraddlePillFilter('ALL')" class="btn-secondary" style="width: auto; padding: 6px 16px; margin: 0 auto;">
                            🔄 Show All Instruments
                        </button>
                    </div>`;
                return;
            }

            // Compute structural signature
            const currentStructureSignature = JSON.stringify({
                filter: straddlePillFilterState,
                strats: filteredStrategies.map(s => ({
                    id: s.id,
                    name: s.name,
                    active: s.active,
                    index: s.index_name,
                    exp: s.expiry,
                    qty: s.quantity,
                    type: s.strategy_type,
                    legs: (extractStrategyLegs(s) || []).map(l => `${l.symbol}_${l.strike}_${l.action}_${l.qty}`),
                    collapsed: isStrategyCardCollapsed(s.id),
                    subtab: getOpstraSubtab(s.id),
                    mode: getStratInnerMode(s.id)
                }))
            });

            // If structure is identical and container already has cards rendered, perform in-place updates without tearing DOM
            const existingCards = container.querySelectorAll('.opstra-strat-card');
            if (lastStraddleRenderSignature === currentStructureSignature && existingCards.length === filteredStrategies.length) {
                // Update total PnL in top filter bar
                const totalPnlEl = container.querySelector('#straddleFilterBar .opstra-total-pnl-val');
                if (totalPnlEl) {
                    totalPnlEl.className = `opstra-total-pnl-val ${getPnlClass(totalStraddlePnl)}`;
                    totalPnlEl.textContent = formatPnl(totalStraddlePnl);
                }

                // Update dynamic values on each card
                filteredStrategies.forEach(s => {
                    const card = container.querySelector(`.opstra-strat-card[data-strat-id="${s.id}"]`);
                    if (!card) return;

                    const pnl = getStrategyPnl(s);
                    const pnlEl = card.querySelector('.opstra-header-pnl');
                    if (pnlEl) {
                        pnlEl.className = `opstra-header-pnl ${getPnlClass(pnl)}`;
                        pnlEl.textContent = formatPnl(pnl);
                    }

                    const spotLtp = parseFloat(s.underlying_ltp || s.base_spot_entry || 0);
                    const spotEl = card.querySelector('.opstra-header-spot');
                    if (spotEl && spotLtp > 0) {
                        spotEl.textContent = `₹${spotLtp.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;
                    }

                    // Only update payoff chart smoothly if user is on PAYOFF subtab and chart exists
                    if (!isStrategyCardCollapsed(s.id) && getOpstraSubtab(s.id) === 'PAYOFF') {
                        renderOpstraPayoffChart(s.id, s);
                    }
                });
                return;
            }

            lastStraddleRenderSignature = currentStructureSignature;

            const cardsHtml = filteredStrategies.map(s => {
                const isActive = s.active;
                const isCollapsed = isStrategyCardCollapsed(s.id);
                const pnl = getStrategyPnl(s);
                const currentSubtab = getOpstraSubtab(s.id);
                const metrics = calculateOpstraMetrics(s);
                const lotSize = getBrokerLotSize(s.index_name || 'NIFTY');
                const totalLots = Math.max(1, Math.round((s.quantity || lotSize) / lotSize));

                const spotLtp = parseFloat(s.underlying_ltp || s.base_spot_entry || metrics.spot || 0);
                const spotDiffPct = (s.base_spot_entry && s.underlying_ltp) ? ((s.underlying_ltp - s.base_spot_entry) / s.base_spot_entry * 100).toFixed(2) : '0.00';
                const spotDiffSign = parseFloat(spotDiffPct) >= 0 ? '+' : '';

                // Render Left Column Legs Checklist
                const legsHtml = metrics.legs.map(leg => {
                    const badgeClass = leg.action === 'SELL' ? 'opstra-badge-s' : 'opstra-badge-b';
                    const legPnl = (leg.entry && leg.ltp) ? (leg.action === 'SELL' ? (leg.entry - leg.ltp) * leg.qty : (leg.ltp - leg.entry) * leg.qty) : 0;
                    return `
                    <div class="opstra-leg-item">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="checkbox" checked style="cursor: pointer;">
                            <span class="${badgeClass}">${leg.action === 'SELL' ? 'S' : 'B'}</span>
                            <span style="font-weight: 700; color: #334155;">${totalLots}x</span>
                            <span style="font-weight: 700; color: #0f172a;">${s.index_name} ${formatStrategyExpiry(s)} ${leg.strike} ${leg.type}</span>
                        </div>
                        <div style="text-align: right; font-family: monospace;">
                            <span style="font-weight: 700; color: #0f172a;">₹${leg.ltp.toFixed(2)}</span>
                            <div style="font-size: 10px; font-weight: 800;" class="${getPnlClass(legPnl)}">${formatPnl(legPnl)}</div>
                        </div>
                    </div>`;
                }).join('');

                // Render Opstra Key Metrics Table
                const beString = metrics.breakevens.length > 0 ? metrics.breakevens.map(b => typeof b === 'number' ? `₹${b.toLocaleString('en-IN')}` : b).join(' - ') : '--';
                const metricsTableHtml = `
                <table class="opstra-metrics-table">
                    <tr><td class="metric-label">Prob. of Profit</td><td class="metric-val" style="color: #16a34a;">${metrics.pop}</td></tr>
                    <tr><td class="metric-label">Max. Profit</td><td class="metric-val" style="color: #16a34a;">${metrics.maxProfit}</td></tr>
                    <tr><td class="metric-label">Max. Loss</td><td class="metric-val" style="color: #dc2626;">${metrics.maxLoss}</td></tr>
                    <tr><td class="metric-label">Max RR Ratio</td><td class="metric-val">${metrics.rrRatio}</td></tr>
                    <tr><td class="metric-label">Breakevens</td><td class="metric-val" style="font-size: 10px;">${beString}</td></tr>
                    <tr><td class="metric-label">Total PNL</td><td class="metric-val ${getPnlClass(pnl)}">${formatPnl(pnl)}</td></tr>
                    <tr><td class="metric-label">Net Credit</td><td class="metric-val">₹${Math.round(metrics.netCredit).toLocaleString('en-IN')}</td></tr>
                    <tr><td class="metric-label">Estimated Margin</td><td class="metric-val">${metrics.estMargin}</td></tr>
                </table>`;

                // Render Subtab 2: Greeks Table with Totals
                let totalDelta = 0, totalTheta = 0, totalGamma = 0, totalVega = 0, sumIv = 0, legCount = 0;
                const greeksRows = metrics.legs.map(l => {
                    const g = l.greeks || {};
                    const delta = parseFloat(g.pos_delta || (l.action === 'SELL' ? -0.5 : 0.5) * (l.type === 'CE' ? 1 : -1));
                    const theta = parseFloat(g.pos_theta || (l.entry * 0.05 * l.qty));
                    const gamma = parseFloat(g.pos_gamma || 0.0012);
                    const vega = parseFloat(g.pos_vega || (l.entry * 0.02 * l.qty));
                    const iv = parseFloat(g.iv || 14.5);

                    totalDelta += delta;
                    totalTheta += theta;
                    totalGamma += gamma;
                    totalVega += vega;
                    sumIv += iv;
                    legCount++;

                    return `
                    <tr style="border-bottom: 1px solid #f1f5f9; font-size: 11px;">
                        <td style="padding: 6px 4px; font-weight: 700;">${l.symbol}</td>
                        <td style="padding: 6px 4px; font-family: monospace;">${iv.toFixed(1)}%</td>
                        <td style="padding: 6px 4px; font-family: monospace; font-weight: 700; color: ${delta >= 0 ? '#16a34a' : '#dc2626'};">${delta >= 0 ? '+' : ''}${delta.toFixed(2)}</td>
                        <td style="padding: 6px 4px; font-family: monospace; color: #16a34a;">+₹${Math.round(theta)}</td>
                        <td style="padding: 6px 4px; font-family: monospace;">${gamma.toFixed(4)}</td>
                        <td style="padding: 6px 4px; font-family: monospace; color: #0284c7;">₹${Math.round(vega)}</td>
                    </tr>`;
                }).join('');

                const avgIv = legCount > 0 ? (sumIv / legCount) : 0;
                const greeksFooterHtml = legCount > 0 ? `
                    <tfoot>
                        <tr style="background: #f1f5f9; border-top: 2px solid #cbd5e1; font-size: 11px; font-weight: 800;">
                            <td style="padding: 7px 4px; color: #0f172a;">TOTAL / NET</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: #64748b;">${avgIv.toFixed(1)}% (Avg)</td>
                            <td style="padding: 7px 4px; font-family: monospace; font-weight: 900; color: ${totalDelta >= 0 ? '#16a34a' : '#dc2626'};">${totalDelta >= 0 ? '+' : ''}${totalDelta.toFixed(2)}</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: ${totalTheta >= 0 ? '#16a34a' : '#dc2626'};">${totalTheta >= 0 ? '+' : ''}₹${Math.round(totalTheta).toLocaleString('en-IN')}</td>
                            <td style="padding: 7px 4px; font-family: monospace;">${totalGamma.toFixed(4)}</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: #0284c7;">₹${Math.round(totalVega).toLocaleString('en-IN')}</td>
                        </tr>
                    </tfoot>` : '';

                const greeksTableHtml = `
                <div style="overflow-x: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 12px; font-weight: 800; color: #1e293b;">📊 Strategy Greeks Breakdown</span>
                        <div style="font-size: 10px; font-weight: 700; color: #64748b;">Greeks (₹/lot)</div>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: #f8fafc; color: #475569; font-size: 10px; text-transform: uppercase; font-weight: 800; border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 6px 4px;">Option Leg</th>
                                <th style="padding: 6px 4px;">IV</th>
                                <th style="padding: 6px 4px;">Delta</th>
                                <th style="padding: 6px 4px;">Theta (₹/d)</th>
                                <th style="padding: 6px 4px;">Gamma</th>
                                <th style="padding: 6px 4px;">Vega (₹/1%)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${greeksRows || '<tr><td colspan="6" style="padding: 12px; text-align: center; color: #94a3b8;">No open legs available</td></tr>'}
                        </tbody>
                        ${greeksFooterHtml}
                    </table>
                </div>`;

                // Render Subtab 3: PnL Table with Totals
                let totalLegQty = 0, totalLegPnl = 0;
                const pnlRows = metrics.legs.map(l => {
                    const legPnl = (l.entry && l.ltp) ? (l.action === 'SELL' ? (l.entry - l.ltp) * l.qty : (l.ltp - l.entry) * l.qty) : 0;
                    totalLegQty += l.qty;
                    totalLegPnl += legPnl;

                    return `
                    <tr style="border-bottom: 1px solid #f1f5f9; font-size: 11px;">
                        <td style="padding: 6px 4px; font-weight: 700;">${l.symbol}</td>
                        <td style="padding: 6px 4px;"><span class="${l.action === 'SELL' ? 'opstra-badge-s' : 'opstra-badge-b'}">${l.action}</span></td>
                        <td style="padding: 6px 4px; font-family: monospace;">${l.qty}</td>
                        <td style="padding: 6px 4px; font-family: monospace;">₹${l.entry.toFixed(2)}</td>
                        <td style="padding: 6px 4px; font-family: monospace; font-weight: 700;">₹${l.ltp.toFixed(2)}</td>
                        <td style="padding: 6px 4px; font-family: monospace; font-weight: 800;" class="${getPnlClass(legPnl)}">${formatPnl(legPnl)}</td>
                    </tr>`;
                }).join('');

                const pnlFooterHtml = metrics.legs.length > 0 ? `
                    <tfoot>
                        <tr style="background: #f1f5f9; border-top: 2px solid #cbd5e1; font-size: 11px; font-weight: 800;">
                            <td colspan="2" style="padding: 7px 4px; color: #0f172a;">TOTAL</td>
                            <td style="padding: 7px 4px; font-family: monospace;">${totalLegQty}</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: #64748b;">--</td>
                            <td style="padding: 7px 4px; font-family: monospace; color: #64748b;">--</td>
                            <td style="padding: 7px 4px; font-family: monospace; font-size: 12px; font-weight: 900;" class="${getPnlClass(pnl)}">${formatPnl(pnl)}</td>
                        </tr>
                    </tfoot>` : '';

                const pnlTableHtml = `
                <div style="overflow-x: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 12px; font-weight: 800; color: #1e293b;">💰 Position-wise P&amp;L Ledger</span>
                        <span style="font-size: 12px; font-weight: 800;" class="${getPnlClass(pnl)}">Total: ${formatPnl(pnl)}</span>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: #f8fafc; color: #475569; font-size: 10px; text-transform: uppercase; font-weight: 800; border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 6px 4px;">Symbol</th>
                                <th style="padding: 6px 4px;">Action</th>
                                <th style="padding: 6px 4px;">Qty</th>
                                <th style="padding: 6px 4px;">Entry Price</th>
                                <th style="padding: 6px 4px;">Current LTP</th>
                                <th style="padding: 6px 4px;">Leg P&amp;L</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pnlRows || '<tr><td colspan="6" style="padding: 12px; text-align: center; color: #94a3b8;">No positions active</td></tr>'}
                        </tbody>
                        ${pnlFooterHtml}
                    </table>
                </div>`;

                return `
                <div class="opstra-strat-card ${isActive ? 'active-strat' : 'inactive-strat'}" data-strat-id="${s.id}">
                    <!-- Card Top Header Row -->
                    <div class="opstra-card-header-row" onclick="toggleStrategyCard('${s.id}')">
                        <div onclick="event.stopPropagation()">
                            <input type="checkbox" class="opstra-card-chk" style="cursor: pointer; width: 15px; height: 15px;">
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-weight: 800; font-size: 13px; color: #0f172a;">${s.index_name} ${formatStrategyExpiry(s)}</span>
                            <span style="font-size: 10px; color: #64748b;">${s.strategy_type || 'STRADDLE'} • ${s.product || 'NRML'} • ${totalLots} Lot${totalLots > 1 ? 's' : ''} (${s.quantity || lotSize} Qty)</span>
                        </div>
                        <div>
                            <span class="opstra-header-spot" style="font-weight: 800; font-size: 12px; font-family: monospace; color: #0f172a;">₹${spotLtp.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
                            <span style="font-size: 10px; font-weight: 700; color: ${parseFloat(spotDiffPct) >= 0 ? '#16a34a' : '#dc2626'}; font-family: monospace;">(${spotDiffSign}${spotDiffPct}%)</span>
                        </div>
                        <div>
                            <span style="font-weight: 700; font-size: 13px; color: #334155;">${s.name || 'Straddle Total SL'}</span>
                        </div>
                        <div style="text-align: center;">
                            <span class="opstra-status-dot ${isActive ? 'active' : 'inactive'}" title="${isActive ? 'Strategy Active & Running' : 'Strategy Inactive'}"></span>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 14px; font-weight: 800; font-family: 'JetBrains Mono', monospace;" class="opstra-header-pnl ${getPnlClass(pnl)}">${formatPnl(pnl)}</span>
                        </div>
                        <div style="text-align: right;">
                            <span id="stratCardChevron_${s.id}" class="strat-card-chevron ${isCollapsed ? 'collapsed' : ''}">▼</span>
                        </div>
                    </div>

                    <!-- Collapsible Dropdown Panel -->
                    <div id="stratCardBody_${s.id}" class="opstra-dropdown-panel" style="display: ${isCollapsed ? 'none' : 'block'};">
                        <div class="opstra-panel-grid">
                            <!-- Left Column: Positions & Key Opstra Metrics -->
                            <div class="opstra-left-col">
                                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.5px;">
                                    Strategy Positions
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    ${legsHtml || '<div style="font-size: 11px; color: #94a3b8; font-style: italic;">No option legs calculated yet. Click 🔍 Calc Strikes below.</div>'}
                                </div>
                                ${metricsTableHtml}
                            </div>

                            <!-- Right Column: 4 Subtabs (Payoff Chart, Greeks, PnL, Edit) -->
                            <div>
                                <div class="opstra-subtabs-nav" id="opstraSubtabsNav_${s.id}">
                                    <button type="button" class="opstra-subtab-btn ${currentSubtab === 'PAYOFF' ? 'active' : ''}" data-tab="PAYOFF" onclick="switchOpstraSubtab('${s.id}', 'PAYOFF')">
                                        📈 Payoff Chart
                                    </button>
                                    <button type="button" class="opstra-subtab-btn ${currentSubtab === 'GREEKS' ? 'active' : ''}" data-tab="GREEKS" onclick="switchOpstraSubtab('${s.id}', 'GREEKS')">
                                        📊 Greeks
                                    </button>
                                    <button type="button" class="opstra-subtab-btn ${currentSubtab === 'PNL' ? 'active' : ''}" data-tab="PNL" onclick="switchOpstraSubtab('${s.id}', 'PNL')">
                                        💰 P&amp;L
                                    </button>
                                    <button type="button" class="opstra-subtab-btn ${currentSubtab === 'EDIT' ? 'active' : ''}" data-tab="EDIT" onclick="switchOpstraSubtab('${s.id}', 'EDIT')">
                                        ✏️ Edit Strategy
                                    </button>
                                </div>

                                <!-- Subtab 1: Payoff Chart -->
                                <div id="opstraPane_payoff_${s.id}" style="display: ${currentSubtab === 'PAYOFF' ? 'block' : 'none'};">
                                    <div style="height: 280px; width: 100%; position: relative;">
                                        <canvas id="opstraPayoffCanvas_${s.id}"></canvas>
                                    </div>
                                </div>

                                <!-- Subtab 2: Greeks -->
                                <div id="opstraPane_greeks_${s.id}" style="display: ${currentSubtab === 'GREEKS' ? 'block' : 'none'};">
                                    ${greeksTableHtml}
                                </div>

                                <!-- Subtab 3: PnL -->
                                <div id="opstraPane_pnl_${s.id}" style="display: ${currentSubtab === 'PNL' ? 'block' : 'none'};">
                                    ${pnlTableHtml}
                                </div>

                                <!-- Subtab 4: Edit Strategy -->
                                <div id="opstraPane_edit_${s.id}" style="display: ${currentSubtab === 'EDIT' ? 'block' : 'none'};">
                                    ${buildStraddleInlineEditPanel(s)}
                                </div>
                            </div>
                        </div>

                        <!-- Bottom Action Buttons Bar -->
                        <div class="opstra-bottom-actions">
                            <button onclick="toggleStraddleStrategy('${s.id}')" class="btn-opstra ${isActive ? 'btn-opstra-danger' : 'btn-opstra-primary'}">
                                ${isActive ? '⏹️ Stop Strategy' : '▶️ Start Strategy'}
                            </button>
                            <button onclick="calculateStraddleStrikesFor('${s.id}')" class="btn-opstra btn-opstra-secondary" title="Recalculate strikes">
                                🔍 Calc Strikes
                            </button>
                            <button onclick="squareoffStraddleStrategy('${s.id}')" class="btn-opstra btn-opstra-danger" title="Square off open legs">
                                ⚡ Square Off / Exit
                            </button>
                            <button onclick="switchOpstraSubtab('${s.id}', 'EDIT')" class="btn-opstra btn-opstra-secondary">
                                ✏️ Edit
                            </button>
                            <button onclick="deleteStraddleStrategy('${s.id}')" class="btn-opstra btn-opstra-secondary" style="color: #dc2626;" title="Delete Strategy">
                                🗑️ Delete
                            </button>
                        </div>
                    </div>
                </div>`;
            }).join('');

            // Render Opstra Top Filter Bar + Strategy Cards
            container.innerHTML = `
                <div class="opstra-filter-bar" id="straddleFilterBar">
                    <div class="opstra-bulk-links">
                        <span class="link-btn" onclick="selectAllCards('STRADDLE')">SELECT ALL</span>
                        <span class="link-btn" onclick="expandAllCards('STRADDLE')">EXPAND ALL</span>
                        <span class="link-btn" onclick="collapseAllCards('STRADDLE')">COLLAPSE ALL</span>
                    </div>
                    <div class="opstra-pill-group">
                        <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'ALL' ? 'active' : ''}" data-inst="ALL" onclick="setStraddlePillFilter('ALL')">ALL</button>
                        <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'BANKNIFTY' ? 'active' : ''}" data-inst="BANKNIFTY" onclick="setStraddlePillFilter('BANKNIFTY')">BANKNIFTY</button>
                        <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'NIFTY' ? 'active' : ''}" data-inst="NIFTY" onclick="setStraddlePillFilter('NIFTY')">NIFTY</button>
                        <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'SENSEX' ? 'active' : ''}" data-inst="SENSEX" onclick="setStraddlePillFilter('SENSEX')">SENSEX</button>
                        <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'FINNIFTY' ? 'active' : ''}" data-inst="FINNIFTY" onclick="setStraddlePillFilter('FINNIFTY')">FINNIFTY</button>
                        <button type="button" class="opstra-pill-btn ${straddlePillFilterState === 'MIDCPNIFTY' ? 'active' : ''}" data-inst="MIDCPNIFTY" onclick="setStraddlePillFilter('MIDCPNIFTY')">MIDCPNIFTY</button>
                    </div>
                    <div style="font-size: 13px; font-weight: 800; font-family: monospace;">
                        <span style="color: #64748b; font-size: 11px; font-weight: 700; font-family: sans-serif;">Total PNL: </span>
                        <span class="opstra-total-pnl-val ${getPnlClass(totalStraddlePnl)}">${formatPnl(totalStraddlePnl)}</span>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${cardsHtml}
                </div>
            `;

            // Initialize payoff charts on expanded cards
            setTimeout(() => {
                filteredStrategies.forEach(s => {
                    if (!isStrategyCardCollapsed(s.id) && getOpstraSubtab(s.id) === 'PAYOFF') {
                        renderOpstraPayoffChart(s.id, s);
                    }
                });
            }, 100);
        }

        function onStraddleStratTypeChange() {
            const stratType = document.getElementById('straddleStratType').value;
            const legSelGroup = document.getElementById('straddleLegSelectionGroup');
            const singleLegPanel = document.getElementById('straddleSingleLegEntryTriggerPanel');
            const optPrem = document.getElementById('optStrikePremium');
            const strangleStrikes = document.getElementById('straddleStrangleStrikesPanel');
            const stranglePrem = document.getElementById('straddleStranglePremiumPanel');

            if (stratType === 'INDIVIDUAL_LEG') {
                legSelGroup.style.display = 'block';
                singleLegPanel.style.display = 'block';
                if (optPrem) optPrem.style.display = 'none';
            } else if (stratType === 'STRANGLE') {
                legSelGroup.style.display = 'none';
                singleLegPanel.style.display = 'none';
                if (optPrem) optPrem.style.display = 'block';
            } else {
                legSelGroup.style.display = 'none';
                singleLegPanel.style.display = 'none';
                if (optPrem) optPrem.style.display = 'none';
                if (document.getElementById('straddleStrikeMode').value === 'PREMIUM') {
                    document.getElementById('straddleStrikeMode').value = 'ATM';
                }
            }
            onStraddleEntryTriggerTypeChange();
            onStraddleStrikeModeChange();
            autoSuggestStraddleName();
        }

        function onStraddleEntryTriggerTypeChange() {
            const triggerType = document.getElementById('straddleEntryTriggerType').value;
            const decayGroup = document.getElementById('straddleEntryDecayGroup');
            const premValGroup = document.getElementById('straddleEntryPremValGroup');

            if (triggerType === 'PREMIUM_DECAY') {
                decayGroup.style.display = 'block';
                premValGroup.style.display = 'none';
            } else if (triggerType === 'SPECIFIC_PREMIUM') {
                decayGroup.style.display = 'none';
                premValGroup.style.display = 'block';
            } else {
                decayGroup.style.display = 'none';
                premValGroup.style.display = 'none';
            }
        }


        function onStraddleStrikeModeChange() {
            const stratType = document.getElementById('straddleStratType').value;
            const mode = document.getElementById('straddleStrikeMode').value;
            const multGroup = document.getElementById('straddleMultipleGroup');
            const manualGroup = document.getElementById('straddleManualStrikeGroup');
            const strangleStrikes = document.getElementById('straddleStrangleStrikesPanel');
            const stranglePrem = document.getElementById('straddleStranglePremiumPanel');
            const hint = document.getElementById('straddleStrikeModeHint');

            if (stratType === 'STRANGLE') {
                if (mode === 'MANUAL') {
                    multGroup.style.display = 'none';
                    manualGroup.style.display = 'none';
                    strangleStrikes.style.display = 'block';
                    stranglePrem.style.display = 'none';
                    if (hint) hint.textContent = 'Enter specific custom strikes for CE and PE legs';
                } else if (mode === 'PREMIUM') {
                    multGroup.style.display = 'none';
                    manualGroup.style.display = 'none';
                    strangleStrikes.style.display = 'none';
                    stranglePrem.style.display = 'block';
                    if (hint) hint.textContent = 'Finds strikes closest to Target Premium for CE & PE';
                } else {
                    multGroup.style.display = 'block';
                    manualGroup.style.display = 'none';
                    strangleStrikes.style.display = 'none';
                    stranglePrem.style.display = 'none';
                    if (hint) hint.textContent = 'Selects OTM CE (Spot + Step) and OTM PE (Spot - Step)';
                }
            } else {
                strangleStrikes.style.display = 'none';
                stranglePrem.style.display = 'none';
                if (mode === 'ROUND_OFF') {
                    multGroup.style.display = 'block';
                    manualGroup.style.display = 'none';
                    if (hint) hint.textContent = 'Rounds Spot LTP to nearest multiple (e.g. 24300 ➔ 24500)';
                } else if (mode === 'MANUAL') {
                    multGroup.style.display = 'none';
                    manualGroup.style.display = 'block';
                    if (hint) hint.textContent = 'Executes orders directly at this user-specified strike';
                } else {
                    multGroup.style.display = 'none';
                    manualGroup.style.display = 'none';
                    if (hint) hint.textContent = stratType === 'INDIVIDUAL_LEG' ? 'Enters individual leg at closest ATM strike' : 'Pairs BOTH CE & PE at closest ATM strike to Spot LTP';
                }
            }
        }

        let currentStraddleAdjManualLegs = [];

        function toggleStraddleAdjustmentsSection() {
            const enabled = document.getElementById('straddleEnableAdjustments').checked;
            document.getElementById('straddleAdjustmentsContainer').style.display = enabled ? 'block' : 'none';
        }

        function toggleStraddleAutoDecaySection() {
            const enabled = document.getElementById('straddleEnableAutoDecay').checked;
            const fields = document.getElementById('straddleAdjAutoFields');
            if (fields) fields.style.display = enabled ? 'block' : 'none';
        }

        function toggleStraddleSpotDistSection() {
            const chk = document.getElementById('straddleEnableSpotDist');
            if (!chk) return;
            const enabled = chk.checked;
            const fields = document.getElementById('straddleSpotDistFields') || document.getElementById('straddleAdjSpotDistFields');
            if (fields) fields.style.display = enabled ? 'block' : 'none';
            const container = document.getElementById('straddleSpotDistRulesContainer') || document.getElementById('straddleSpotRulesList');
            if (enabled && container && container.children.length === 0) {
                addSpotDistRuleRow({ action: 'SELL', move_step_pts: 500, strike_offset_pts: 2000, round_multiple: 500 });
            }
        }

        function toggleStraddleManualLegsSection() {
            const chk = document.getElementById('straddleEnableManualLegs');
            if (!chk) return;
            const enabled = chk.checked;
            const fields = document.getElementById('straddleManualLegsFields');
            if (fields) fields.style.display = enabled ? 'block' : 'none';
            const container = document.getElementById('straddleManualLegsContainer') || document.getElementById('straddleManualLegsList');
            if (enabled && container && container.children.length === 0) {
                addManualAdjLegRow();
            }
        }

        function setStraddleAdjMode(mode) {
            // Backward-compatible setter
            if (mode === 'SPOT_DISTANCE') {
                if (document.getElementById('straddleEnableSpotDist')) document.getElementById('straddleEnableSpotDist').checked = true;
            } else if (mode === 'MANUAL') {
                if (document.getElementById('straddleEnableManualLegs')) document.getElementById('straddleEnableManualLegs').checked = true;
            } else if (mode === 'ALL') {
                if (document.getElementById('straddleEnableAutoDecay')) document.getElementById('straddleEnableAutoDecay').checked = true;
                if (document.getElementById('straddleEnableSpotDist')) document.getElementById('straddleEnableSpotDist').checked = true;
                if (document.getElementById('straddleEnableManualLegs')) document.getElementById('straddleEnableManualLegs').checked = true;
            } else {
                if (document.getElementById('straddleEnableAutoDecay')) document.getElementById('straddleEnableAutoDecay').checked = true;
            }
            toggleStraddleAutoDecaySection();
            toggleStraddleSpotDistSection();
            toggleStraddleManualLegsSection();
        }

        function addSpotDistRuleRow(data = {}) {
            const container = document.getElementById('straddleSpotDistRulesContainer') || document.getElementById('straddleSpotRulesList');
            if (!container) return;
            const rowId = data.id || `srule_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const action = data.action || 'SELL';
            const moveStep = data.move_step_pts !== undefined ? data.move_step_pts : 500;
            const bufferPct = data.near_buffer_pct !== undefined ? data.near_buffer_pct : 10;
            const offsetPts = data.strike_offset_pts !== undefined ? data.strike_offset_pts : 2000;
            const roundMult = data.round_multiple !== undefined ? data.round_multiple : 500;
            const lots = data.lots || 1;
            const maxAdjs = data.max_adjustments || 5;
            const slType = data.sl_type || 'PERCENT';
            const slVal = data.sl_value !== undefined ? data.sl_value : 30;
            const enableTsl = data.enable_tsl !== undefined ? data.enable_tsl : true;
            const tslStep = data.tsl_step !== undefined ? data.tsl_step : 10;
            const tslVal = data.tsl_value !== undefined ? data.tsl_value : 10;

            const row = document.createElement('div');
            row.className = 'spot-dist-rule-row';
            row.dataset.id = rowId;
            row.style.cssText = 'background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px; margin-bottom: 6px; font-size: 11px;';
            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-weight: 800; color: #0369a1;">Rule #${container.children.length + 1}:</span>
                        <span style="background: ${action === 'BUY' ? '#dcfce7' : '#fee2e2'}; color: ${action === 'BUY' ? '#15803d' : '#b91c1c'}; padding: 1px 6px; border-radius: 3px; font-weight: 800; font-size: 10px;">${action}</span>
                    </div>
                    <button type="button" onclick="this.closest('.spot-dist-rule-row').remove()" style="background: none; border: none; color: #ef4444; font-weight: 700; cursor: pointer; font-size: 13px;">✕ Remove</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #0369a1;">Action</label>
                        <select class="srule-action" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                            <option value="SELL" ${action === 'SELL' ? 'selected' : ''}>SELL</option>
                            <option value="BUY" ${action === 'BUY' ? 'selected' : ''}>BUY</option>
                            <option value="BOTH" ${action === 'BOTH' ? 'selected' : ''}>BUY &amp; SELL</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #0369a1;">Move Step (Pts)</label>
                        <input type="number" class="srule-move" value="${moveStep}" step="any" placeholder="e.g. 500" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #0369a1;">Near Buffer (%)</label>
                        <input type="number" class="srule-buffer" value="${bufferPct}" step="0.5" placeholder="e.g. 10%" style="font-size: 11px; font-weight: 700; padding: 4px 6px;" title="Triggers order when spot price is within this % of the move step">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #0369a1;">Strike Offset (Pts)</label>
                        <input type="number" class="srule-offset" value="${offsetPts}" step="any" placeholder="e.g. 2000" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #0369a1;">Round Multiple</label>
                        <input type="number" class="srule-round" value="${roundMult}" step="any" placeholder="e.g. 500" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #475569;">Lots / Trigger</label>
                        <input type="number" class="srule-lots" value="${lots}" min="1" step="1" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #475569;">Max Times</label>
                        <input type="number" class="srule-max-count" value="${maxAdjs}" min="1" step="1" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #991b1b;">SL Mode</label>
                        <select class="srule-sl-type" style="font-size: 11px; font-weight: 600; padding: 4px 6px;">
                            <option value="PERCENT" ${slType === 'PERCENT' ? 'selected' : ''}>Percent (%)</option>
                            <option value="POINTS" ${slType === 'POINTS' ? 'selected' : ''}>Points (pts)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #991b1b;">SL Value</label>
                        <input type="number" class="srule-sl-val" value="${slVal}" step="0.5" style="font-size: 11px; font-weight: 700; padding: 4px 6px; color: #991b1b;">
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 700; color: #166534; background: #ffffff; padding: 4px 8px; border-radius: 4px; border: 1px dashed #86efac;">
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; margin-bottom: 0;">
                        <input type="checkbox" class="srule-enable-tsl" ${enableTsl ? 'checked' : ''} style="width: 13px; height: 13px; accent-color: #16a34a;">
                        <span>🎯 Enable TSL:</span>
                    </label>
                    <span>Trail Step:</span>
                    <input type="number" class="srule-tsl-step" value="${tslStep}" step="0.5" style="width: 50px; font-size: 10px; padding: 2px 4px;">
                    <span>Move:</span>
                    <input type="number" class="srule-tsl-val" value="${tslVal}" step="0.5" style="width: 50px; font-size: 10px; padding: 2px 4px;">
                </div>
            `;
            container.appendChild(row);
        }

        function collectSpotDistRulesFromUI() {
            const rows = document.querySelectorAll('.spot-dist-rule-row');
            const rules = [];
            rows.forEach((row, idx) => {
                const action = row.querySelector('.srule-action').value;
                const moveStep = parseFloat(row.querySelector('.srule-move').value) || 500.0;
                const bufferPct = parseFloat(row.querySelector('.srule-buffer').value) || 10.0;
                const offsetPts = parseFloat(row.querySelector('.srule-offset').value) || 2000.0;
                const roundMult = parseFloat(row.querySelector('.srule-round').value) || 500.0;
                const lots = parseInt(row.querySelector('.srule-lots').value) || 1;
                const maxAdjs = parseInt(row.querySelector('.srule-max-count').value) || 5;
                const slType = row.querySelector('.srule-sl-type').value;
                const slVal = parseFloat(row.querySelector('.srule-sl-val').value) || 30.0;
                const enableTsl = row.querySelector('.srule-enable-tsl').checked;
                const tslStep = parseFloat(row.querySelector('.srule-tsl-step').value) || 10.0;
                const tslVal = parseFloat(row.querySelector('.srule-tsl-val').value) || 10.0;

                rules.push({
                    id: row.dataset.id || `srule_${idx + 1}`,
                    action: action,
                    move_step_pts: moveStep,
                    near_buffer_pct: bufferPct,
                    strike_offset_pts: offsetPts,
                    round_multiple: roundMult,
                    lots: lots,
                    max_adjustments: maxAdjs,
                    sl_type: slType,
                    sl_value: slVal,
                    enable_tsl: enableTsl,
                    tsl_type: "POINTS",
                    tsl_value: tslVal,
                    tsl_step: tslStep,
                    up_adjustments_done: 0,
                    down_adjustments_done: 0
                });
            });
            return rules;
        }

        function addManualAdjLegRow(data = {}) {
            const container = document.getElementById('straddleManualLegsContainer') || document.getElementById('straddleManualLegsList');
            if (!container) return;
            const rowId = data.id || `mleg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const strike = data.strike || '';
            const optType = data.option_type || 'CE';
            const action = data.action || 'SELL';
            const triggerPrice = data.trigger_price || '';
            const bufferPct = data.near_buffer_pct !== undefined ? data.near_buffer_pct : 10;
            const lots = data.lots || 1;
            const slVal = data.sl_value || 30;
            const enableTsl = data.enable_tsl !== undefined ? data.enable_tsl : true;
            const tslStep = data.tsl_step || 10;
            const tslVal = data.tsl_value || 10;

            const row = document.createElement('div');
            row.className = 'manual-adj-leg-row';
            row.dataset.id = rowId;
            row.style.cssText = 'background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; margin-bottom: 6px; font-size: 11px;';
            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-weight: 700; color: #0f766e;">Leg #${container.children.length + 1}</span>
                    <button type="button" onclick="this.closest('.manual-adj-leg-row').remove()" style="background: none; border: none; color: #ef4444; font-weight: 700; cursor: pointer; font-size: 13px;">✕</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #475569;">Strike</label>
                        <input type="number" class="mleg-strike" value="${strike}" step="50" placeholder="e.g. 24800" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #475569;">Type</label>
                        <select class="mleg-type" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                            <option value="CE" ${optType === 'CE' ? 'selected' : ''}>CE</option>
                            <option value="PE" ${optType === 'PE' ? 'selected' : ''}>PE</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #475569;">Action</label>
                        <select class="mleg-action" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                            <option value="SELL" ${action === 'SELL' ? 'selected' : ''}>SELL</option>
                            <option value="BUY" ${action === 'BUY' ? 'selected' : ''}>BUY</option>
                        </select>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #0284c7;">Target Trigger ₹</label>
                        <input type="number" class="mleg-trigger" value="${triggerPrice}" step="0.5" placeholder="e.g. 80" style="font-size: 11px; font-weight: 700; padding: 4px 6px; border-color: #7dd3fc;">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #0284c7;">Near Buffer (%)</label>
                        <input type="number" class="mleg-buffer" value="${bufferPct}" step="0.5" placeholder="e.g. 10%" style="font-size: 11px; font-weight: 700; padding: 4px 6px;" title="Sends order when LTP is within this % of the trigger price">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #475569;">Lots</label>
                        <input type="number" class="mleg-lots" value="${lots}" min="1" step="1" style="font-size: 11px; font-weight: 700; padding: 4px 6px;">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #991b1b;">SL (% / Pts)</label>
                        <input type="number" class="mleg-sl" value="${slVal}" step="0.5" style="font-size: 11px; font-weight: 700; padding: 4px 6px; color: #991b1b;">
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 700; color: #166534;">
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; margin-bottom: 0;">
                        <input type="checkbox" class="mleg-enable-tsl" ${enableTsl ? 'checked' : ''} style="width: 13px; height: 13px; accent-color: #16a34a;">
                        <span>TSL:</span>
                    </label>
                    <span>Trail Step:</span>
                    <input type="number" class="mleg-tsl-step" value="${tslStep}" step="0.5" style="width: 50px; font-size: 10px; padding: 2px 4px;">
                    <span>Move:</span>
                    <input type="number" class="mleg-tsl-val" value="${tslVal}" step="0.5" style="width: 50px; font-size: 10px; padding: 2px 4px;">
                </div>
            `;
            container.appendChild(row);
        }

        function collectManualAdjLegsFromUI() {
            const rows = document.querySelectorAll('.manual-adj-leg-row');
            const legs = [];
            rows.forEach((row, idx) => {
                const strike = parseFloat(row.querySelector('.mleg-strike').value);
                const optType = row.querySelector('.mleg-type').value;
                const action = row.querySelector('.mleg-action').value;
                const triggerPrice = parseFloat(row.querySelector('.mleg-trigger').value);
                const bufferPct = parseFloat(row.querySelector('.mleg-buffer').value) || 10.0;
                const lots = parseInt(row.querySelector('.mleg-lots').value) || 1;
                const slVal = parseFloat(row.querySelector('.mleg-sl').value) || 30.0;
                const enableTsl = row.querySelector('.mleg-enable-tsl').checked;
                const tslStep = parseFloat(row.querySelector('.mleg-tsl-step').value) || 10.0;
                const tslVal = parseFloat(row.querySelector('.mleg-tsl-val').value) || 10.0;

                if (!isNaN(strike) && strike > 0) {
                    legs.push({
                        id: row.dataset.id || `manual_${idx + 1}`,
                        strike: strike,
                        option_type: optType,
                        action: action,
                        trigger_price: !isNaN(triggerPrice) ? triggerPrice : 0.0,
                        near_buffer_pct: bufferPct,
                        lots: lots,
                        sl_type: "PERCENT",
                        sl_value: slVal,
                        enable_tsl: enableTsl,
                        tsl_type: "POINTS",
                        tsl_value: tslVal,
                        tsl_step: tslStep,
                        status: "PENDING"
                    });
                }
            });
            return legs;
        }

        async function squareoffStraddleAdjustmentLeg(stratId, adjId) {
            if (!confirm(`Are you sure you want to square off adjustment leg '${adjId}'?`)) return;
            try {
                const res = await api(`/api/straddle_total_sl/strategies/${stratId}/adjustments/${adjId}/squareoff`, 'POST');
                if (res.status === 'ok') {
                    toast('✅ ' + (res.message || 'Adjustment leg squared off'));
                    fetchStraddleStatus();
                } else {
                    toast('❌ ' + (res.message || 'Error squaring off adjustment leg'), true);
                }
            } catch (err) {
                toast('❌ Network error', true);
            }
        }

        function toggleStraddleBaseTslInput() {
            const enabled = document.getElementById('straddleEnableTsl').checked;
            document.getElementById('straddleBaseTslFields').style.display = enabled ? 'flex' : 'none';
        }

        function openNewStraddleStrategyForm() {
            toggleCardCollapse('straddleFormCollapseContent', 'straddleFormChevron', true);
            document.getElementById('straddleStratId').value = '';
            document.getElementById('straddleFormTitle').textContent = '➕ Create Straddle / Strangle Total SL Strategy';
            document.getElementById('straddleGroupName').value = 'Main Group';
            document.getElementById('straddleStratType').value = 'STRADDLE';
            document.getElementById('straddleLegSelection').value = 'CE_ONLY';
            document.getElementById('straddleEntryTriggerType').value = 'CURRENT_PRICE';
            document.getElementById('straddleEntryDecayPct').value = '20';
            document.getElementById('straddleEntryPremVal').value = '100';
            document.getElementById('straddleIndexName').value = 'NIFTY';
            document.getElementById('straddleStrikeMode').value = 'ATM';
            document.getElementById('straddleStrikeMultiple').value = '500';
            document.getElementById('straddleManualStrike').value = '';
            document.getElementById('straddleCeStrike').value = '';
            document.getElementById('straddlePeStrike').value = '';
            document.getElementById('straddleCeTargetPrem').value = '80';
            document.getElementById('straddlePeTargetPrem').value = '80';
            onStraddleStratTypeChange();
            document.getElementById('straddleEntryAction').value = 'SELL';
            document.getElementById('straddleProduct').value = 'NRML';

            // SL / TSL defaults
            document.getElementById('straddleSlMode').value = 'PERCENT';
            document.getElementById('straddleSlValue').value = '100';
            document.getElementById('straddleTotalTp').value = '50';
            document.getElementById('straddleEnableTsl').checked = false;
            document.getElementById('straddleTslStep').value = '10';
            document.getElementById('straddleTslVal').value = '10';
            toggleStraddleBaseTslInput();

            document.getElementById('straddleStartTime').value = '15:00:00';
            document.getElementById('straddleExitDaysToExpiry').value = '0';
            document.getElementById('straddleEndTime').value = '15:15:00';

            // Reset adjustments
            document.getElementById('straddleEnableAdjustments').checked = false;
            toggleStraddleAdjustmentsSection();
            if (document.getElementById('straddleEnableAutoDecay')) document.getElementById('straddleEnableAutoDecay').checked = true;
            if (document.getElementById('straddleEnableSpotDist')) document.getElementById('straddleEnableSpotDist').checked = false;
            if (document.getElementById('straddleEnableManualLegs')) document.getElementById('straddleEnableManualLegs').checked = false;
            toggleStraddleAutoDecaySection();
            toggleStraddleSpotDistSection();
            toggleStraddleManualLegsSection();

            document.getElementById('straddleAdjDecayPct').value = 20;
            document.getElementById('straddleAdjMaxCount').value = 3;
            document.getElementById('straddleAdjLots').value = 1;
            document.getElementById('straddleAdjSlType').value = 'PERCENT';
            document.getElementById('straddleAdjSlValue').value = 30;
            document.getElementById('straddleAdjEnableTsl').checked = true;
            const spotList = document.getElementById('straddleSpotDistRulesContainer') || document.getElementById('straddleSpotRulesList');
            if (spotList) spotList.innerHTML = '';
            const manList = document.getElementById('straddleManualLegsContainer') || document.getElementById('straddleManualLegsList');
            if (manList) manList.innerHTML = '';
            currentStraddleAdjManualLegs = [];

            onStraddleIndexChange(true);
            autoSuggestStraddleName(true);
            document.getElementById('straddleEditCard').scrollIntoView({ behavior: 'smooth' });
        }

        function editStraddleStrategy(stratId) {
            toggleStrategyInlineEdit('STRADDLE', stratId);
        }

        function cancelStraddleEditForm() {
            openNewStraddleStrategyForm();
        }

        async function saveStraddleStrategyConfig(e) {
            e.preventDefault();
            const stratId = document.getElementById('straddleStratId').value;
            const stratType = document.getElementById('straddleStratType').value;
            const legSel = document.getElementById('straddleLegSelection').value;
            const entryTriggerType = document.getElementById('straddleEntryTriggerType').value;
            const triggerDecayPct = parseFloat(document.getElementById('straddleEntryDecayPct').value) || 20.0;
            const triggerPremVal = parseFloat(document.getElementById('straddleEntryPremVal').value) || 0.0;
            const indexName = document.getElementById('straddleIndexName').value;
            const strikeMode = document.getElementById('straddleStrikeMode').value;
            const strikeMultiple = parseFloat(document.getElementById('straddleStrikeMultiple').value) || 500;
            const manualStrikeVal = parseFloat(document.getElementById('straddleManualStrike').value);
            const ceStrikeVal = parseFloat(document.getElementById('straddleCeStrike').value);
            const peStrikeVal = parseFloat(document.getElementById('straddlePeStrike').value);
            const ceTargetPrem = parseFloat(document.getElementById('straddleCeTargetPrem').value) || 80;
            const peTargetPrem = parseFloat(document.getElementById('straddlePeTargetPrem').value) || 80;

            const enableAdj = document.getElementById('straddleEnableAdjustments').checked;
            const enableAutoDecay = document.getElementById('straddleEnableAutoDecay') ? document.getElementById('straddleEnableAutoDecay').checked : true;
            const enableSpotDist = document.getElementById('straddleEnableSpotDist') ? document.getElementById('straddleEnableSpotDist').checked : false;
            const enableManualLegs = document.getElementById('straddleEnableManualLegs') ? document.getElementById('straddleEnableManualLegs').checked : false;
            const spotDistRulesData = collectSpotDistRulesFromUI();
            const manualLegsData = collectManualAdjLegsFromUI();

            const slMode = document.getElementById('straddleSlMode').value;
            const slVal = parseFloat(document.getElementById('straddleSlValue').value) || 100.0;
            const tpVal = parseFloat(document.getElementById('straddleTotalTp').value) || 50.0;
            const enableTsl = document.getElementById('straddleEnableTsl').checked;
            const tslStep = parseFloat(document.getElementById('straddleTslStep').value) || 10.0;
            const tslVal = parseFloat(document.getElementById('straddleTslVal').value) || 10.0;

            const autoResolvedGroup = getAutomaticStraddleGroupName({
                strategy_type: stratType,
                leg_selection: legSel
            });

            const underlyingType = document.getElementById('straddleUnderlyingType') ? document.getElementById('straddleUnderlyingType').value : 'CASH';

            const payload = {
                id: stratId || undefined,
                name: document.getElementById('straddleStratName').value.trim(),
                group_name: autoResolvedGroup,
                strategy_type: stratType,
                leg_selection: stratType === 'INDIVIDUAL_LEG' ? legSel : 'BOTH',
                entry_trigger_type: stratType === 'INDIVIDUAL_LEG' ? entryTriggerType : 'CURRENT_PRICE',
                trigger_decay_pct: triggerDecayPct,
                trigger_premium_val: triggerPremVal,
                index_name: indexName,
                underlying_type: underlyingType,
                expiry: document.getElementById('straddleExpirySelect').value,
                strike_mode: strikeMode,
                strike_multiple: strikeMultiple,
                manual_strike: !isNaN(manualStrikeVal) && manualStrikeVal > 0 ? manualStrikeVal : undefined,
                ce_strike: !isNaN(ceStrikeVal) && ceStrikeVal > 0 ? ceStrikeVal : undefined,
                pe_strike: !isNaN(peStrikeVal) && peStrikeVal > 0 ? peStrikeVal : undefined,
                ce_target_premium: ceTargetPrem,
                pe_target_premium: peTargetPrem,
                strike: strikeMode === 'MANUAL' && !isNaN(manualStrikeVal) ? String(manualStrikeVal) : (strikeMode === 'ROUND_OFF' ? `ROUND_${strikeMultiple}` : 'ATM'),
                entry_action: document.getElementById('straddleEntryAction').value,
                product: document.getElementById('straddleProduct').value,
                sl_mode: slMode,
                sl_value: slVal,
                tp_mode: slMode,
                tp_value: tpVal,
                total_sl_percent: slVal,
                total_tp_percent: tpVal,
                enable_tsl: enableTsl,
                tsl_type: "POINTS",
                tsl_step: tslStep,
                tsl_value: tslVal,
                quantity: parseInt(document.getElementById('straddleQuantity').value),
                entry_time: document.getElementById('straddleStartTime').value,
                exit_time: document.getElementById('straddleEndTime').value,
                exit_days_to_expiry: parseInt(document.getElementById('straddleExitDaysToExpiry').value) || 0,
                adjustments: {
                    enabled: enableAdj,
                    mode: "ALL",
                    auto_config: {
                        enabled: enableAutoDecay,
                        trigger_decay_percent: parseFloat(document.getElementById('straddleAdjDecayPct').value) || 15.0,
                        near_buffer_percent: parseFloat(document.getElementById('straddleAdjDecayBufferPct').value) || 0.0,
                        max_adjustments: parseInt(document.getElementById('straddleAdjMaxCount').value) || 3,
                        lots: parseInt(document.getElementById('straddleAdjLots').value) || 1,
                        sl_type: document.getElementById('straddleAdjSlType').value,
                        sl_value: parseFloat(document.getElementById('straddleAdjSlValue').value) || 30.0,
                        enable_tsl: document.getElementById('straddleAdjEnableTsl').checked,
                        tsl_type: "POINTS",
                        tsl_value: parseFloat(document.getElementById('straddleAdjTslVal').value) || 10.0,
                        tsl_step: parseFloat(document.getElementById('straddleAdjTslStep').value) || 10.0
                    },
                    enable_spot_dist: enableSpotDist,
                    spot_distance_rules: spotDistRulesData,
                    spot_distance_config: spotDistRulesData[0] || {},
                    enable_manual: enableManualLegs,
                    manual_legs: manualLegsData
                }
            };

            try {
                const res = await api('/api/straddle_total_sl/strategies', 'POST', payload);
                if (res.status === 'ok') {
                    toast('✅ Straddle Strategy saved successfully');
                    fetchStraddleStatus();
                    openNewStraddleStrategyForm();
                } else {
                    toast('❌ Error saving strategy: ' + (res.message || 'Unknown error'), true);
                }
            } catch (err) {
                toast('❌ Network or Server error while saving', true);
            }
        }

        if (document.getElementById('straddleIndexName')) {
            document.getElementById('straddleIndexName').addEventListener('change', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddleExpirySelect')) {
            document.getElementById('straddleExpirySelect').addEventListener('change', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddleStratType')) {
            document.getElementById('straddleStratType').addEventListener('change', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddleLegSelection')) {
            document.getElementById('straddleLegSelection').addEventListener('change', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddleStrikeMode')) {
            document.getElementById('straddleStrikeMode').addEventListener('change', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddleStrikeMultiple')) {
            document.getElementById('straddleStrikeMultiple').addEventListener('input', () => autoSuggestStraddleName());
            document.getElementById('straddleStrikeMultiple').addEventListener('change', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddleManualStrike')) {
            document.getElementById('straddleManualStrike').addEventListener('input', () => autoSuggestStraddleName());
            document.getElementById('straddleManualStrike').addEventListener('change', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddleCeStrike')) {
            document.getElementById('straddleCeStrike').addEventListener('input', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddlePeStrike')) {
            document.getElementById('straddlePeStrike').addEventListener('input', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddleCeTargetPrem')) {
            document.getElementById('straddleCeTargetPrem').addEventListener('input', () => autoSuggestStraddleName());
        }
        if (document.getElementById('straddlePeTargetPrem')) {
            document.getElementById('straddlePeTargetPrem').addEventListener('input', () => autoSuggestStraddleName());
        }

        async function fetchStraddlePnlSummary() {
            try {
                const res = await api('/api/straddle_total_sl/pnl/summary');
                if (res.status === 'ok') {
                    straddlePnlSummaryData = res;
                    renderStraddleHistoryTable(res.history || []);
                    const badge = document.getElementById('straddleJournalTradesBadge');
                    if (badge) badge.textContent = `${res.records_count || 0} Trade${res.records_count === 1 ? '' : 's'} in Journal`;
                }
            } catch (e) { }
        }

        async function fetchStraddlePendingOrders() {
            try {
                const res = await api('/api/straddle_total_sl/pending_orders');
                if (res.status === 'ok') {
                    const badge = document.getElementById('straddlePendingOrdersBadge');
                    if (badge) {
                        const count = res.orders_count || 0;
                        badge.textContent = `💾 ${count} Local Order${count === 1 ? '' : 's'} Tracked`;
                        badge.style.background = count > 0 ? '#fef3c7' : '#f1f5f9';
                        badge.style.color = count > 0 ? '#92400e' : '#64748b';
                        badge.style.borderColor = count > 0 ? '#fde68a' : '#e2e8f0';
                    }
                }
            } catch (e) { }
        }

        function toggleStraddleHistoryTable() {
            const container = document.getElementById('straddleHistoryContainer');
            if (container) {
                const isHidden = container.style.display === 'none';
                container.style.display = isHidden ? 'block' : 'none';
                if (isHidden) fetchStraddlePnlSummary();
            }
        }

        function renderStraddleHistoryTable(records) {
            const tbody = document.getElementById('straddleHistoryBody');
            if (!tbody) return;
            if (!records || records.length === 0) {
                tbody.innerHTML = `<tr><td colspan="14" style="text-align: center; color: var(--text-muted); padding: 16px;">No records found in straddle_total_sl_PnL.csv</td></tr>`;
                return;
            }
            tbody.innerHTML = records.map(r => {
                const dayPnl = parseFloat(r.Day_PnL || 0);
                const cumPnl = parseFloat(r.Cumulative_PnL || 0);
                const isClosed = (r.Status === 'CLOSED');
                const ceInfo = r.CE_Symbol && r.CE_Symbol !== '--' ? `${r.CE_Symbol} (${r.CE_Entry_Price || '--'} / ${r.CE_Exit_Price || '--'})` : '--';
                const peInfo = r.PE_Symbol && r.PE_Symbol !== '--' ? `${r.PE_Symbol} (${r.PE_Entry_Price || '--'} / ${r.PE_Exit_Price || '--'})` : '--';
                const exitDate = r.Exit_Date || '--';

                return `<tr>
                    <td>#${r.Serial_No || 1}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">${r.Date || '--'}</td>
                    <td><b>${r.Strategy_Name || 'Straddle Total SL'}</b></td>
                    <td><span style="background: var(--pastel-blue-bg); color: var(--pastel-blue-dark); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 10px;">${r.Instrument || 'NIFTY'}</span></td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #4338ca;">${r.Strike || '--'}</td>
                    <td style="font-family: 'JetBrains Mono', monospace;">${r.Lot_Size || 65}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">${ceInfo}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">${peInfo}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;">₹${parseFloat(r.Initial_Total_Premium || 0).toFixed(2)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700;">₹${parseFloat(r.Exit_Total_Premium || 0).toFixed(2)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800;" class="${getPnlClass(dayPnl)}">${formatPnl(dayPnl)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800;" class="${getPnlClass(cumPnl)}">${formatPnl(cumPnl)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted);">${exitDate}</td>
                    <td><span class="badge-tag ${isClosed ? 'badge-complete' : 'badge-active'}">${r.Status || 'OPEN'}</span></td>
                </tr>`;
            }).join('');
        }

        function downloadStraddlePnlCsv() {
            toast('📥 Downloading straddle_total_sl_PnL.csv...');
            window.location.href = '/api/straddle_total_sl/pnl/download';
        }

        async function toggleStraddleStrategy(stratId) {
            const strat = loadedStraddleStrategies.find(s => s.id === stratId);
            if (!strat) return;
            const newActive = !strat.active;
            const res = await api(`/api/straddle_total_sl/strategies/${stratId}/toggle`, 'POST', { active: newActive });
            if (res.status === 'ok') {
                toast(newActive ? `Started '${strat.name}'` : `Stopped '${strat.name}'`);
                fetchStraddleStatus();
            }
        }

        async function calculateStraddleStrikesFor(stratId) {
            toast('⏳ Calculating Strategy Strikes & LTPs...');
            const res = await api(`/api/straddle_total_sl/strategies/${stratId}/calculate`, 'POST');
            if (res.status === 'ok') {
                toast('✅ ' + (res.message || 'Strikes calculated successfully'));
                fetchStraddleStatus();
            } else {
                toast('❌ ' + (res.message || 'Calculation failed'), true);
            }
        }

        async function squareoffStraddleStrategy(stratId) {
            const strat = loadedStraddleStrategies.find(s => s.id === stratId);
            if (!confirm(`Are you sure you want to square off '${strat ? strat.name : stratId}'?`)) return;
            toast('⚡ Squaring off Straddle Strategy...');
            const res = await api(`/api/straddle_total_sl/strategies/${stratId}/squareoff`, 'POST');
            if (res.status === 'ok') {
                toast('✅ ' + (res.message || 'Square off complete'));
                fetchStraddleStatus();
            } else {
                toast('❌ ' + (res.message || 'Square off failed'), true);
            }
        }

        async function deleteStraddleStrategy(stratId) {
            const strat = loadedStraddleStrategies.find(s => s.id === stratId);
            if (!confirm(`Delete straddle strategy '${strat ? strat.name : stratId}'?`)) return;
            const res = await api(`/api/straddle_total_sl/strategies/${stratId}`, 'DELETE');
            if (res.status === 'ok') {
                toast('Strategy Deleted');
                fetchStraddleStatus();
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // TAB 7: MCX COMMODITY STRATEGY ENGINE
        // ═══════════════════════════════════════════════════════════════

        let loadedCommodityStrategies = [];
        let commodityPnlSummaryData = { records: [], total_trades: 0, realized_pnl: 0 };
        const commodityLotSizes = {
            "CRUDEOIL": 100,
            "CRUDEOILM": 10,
            "NATURALGAS": 1250,
            "NATGASMINI": 250,
            "GOLD": 100,
            "GOLDM": 10,
            "GOLDPETAL": 1,
            "GOLDGUINEA": 8,
            "SILVER": 30,
            "SILVERM": 5,
            "SILVERMIC": 1,
            "COPPER": 2500,
            "ZINC": 5000,
            "LEAD": 5000,
            "ALUMINIUM": 5000,
            "NICKEL": 1500
        };

        function getCommodityLotSize(cname) {
            return commodityLotSizes[String(cname || '').toUpperCase()] || 100;
        }

        function onCommodityUnderlyingChange() {
            const cname = document.getElementById('commCommodityName').value || 'CRUDEOIL';
            const lot = getCommodityLotSize(cname);
            const qtyInput = document.getElementById('commQuantity');
            const lblQty = document.getElementById('lblCommQuantity');

            if (qtyInput) {
                qtyInput.value = lot;
                qtyInput.step = lot;
                qtyInput.min = lot;
            }
            if (lblQty) {
                lblQty.textContent = `Quantity (Lot Size: ${lot} for ${cname})`;
            }

            const nameInput = document.getElementById('commStratName');
            const typeSelect = document.getElementById('commStrategyType');
            if (nameInput && (!nameInput.value || nameInput.value.includes('Crude') || nameInput.value.includes('Commodity') || nameInput.value.includes('Gold') || nameInput.value.includes('Silver') || nameInput.value.includes('Natural Gas'))) {
                const typeName = typeSelect ? typeSelect.options[typeSelect.selectedIndex].text.split(' ')[1] || 'Strategy' : 'Strategy';
                nameInput.value = `${cname} ${typeName}`;
            }

            fetchCommodityExpiries(cname);
        }

        function onCommodityTypeChange() {
            const stype = document.getElementById('commStrategyType').value;
            const optFields = document.getElementById('commOptionsFields');
            const ceGroup = document.getElementById('commCePremGroup');
            const peGroup = document.getElementById('commPePremGroup');

            if (stype === 'FUTURES') {
                if (optFields) optFields.style.display = 'none';
            } else {
                if (optFields) optFields.style.display = 'flex';
                if (stype === 'SINGLE_CE') {
                    if (ceGroup) ceGroup.style.display = 'block';
                    if (peGroup) peGroup.style.display = 'none';
                } else if (stype === 'SINGLE_PE') {
                    if (ceGroup) ceGroup.style.display = 'none';
                    if (peGroup) peGroup.style.display = 'block';
                } else {
                    if (ceGroup) ceGroup.style.display = 'block';
                    if (peGroup) peGroup.style.display = 'block';
                }
            }
        }

        function toggleCommodityTslFields() {
            const enabled = document.getElementById('commEnableTsl').checked;
            const fields = document.getElementById('commTslFields');
            if (fields) fields.style.display = enabled ? 'flex' : 'none';
        }

        async function fetchCommodityExpiries(commodityName) {
            const cname = commodityName || document.getElementById('commCommodityName').value || 'CRUDEOIL';
            const expSelect = document.getElementById('commExpirySelect');
            if (!expSelect) return;

            try {
                const res = await api(`/api/commodity/expiries/${cname}`);
                expSelect.innerHTML = '<option value="CURRENT">Nearest / Active Expiry</option>';
                if (res.status === 'ok' && res.expiries && res.expiries.length > 0) {
                    res.expiries.forEach(exp => {
                        const opt = document.createElement('option');
                        opt.value = exp;
                        opt.textContent = exp;
                        expSelect.appendChild(opt);
                    });
                }
            } catch (e) {
                console.error('Error loading commodity expiries:', e);
            }
        }

        function refreshCommodityExpiries() {
            const cname = document.getElementById('commCommodityName').value || 'CRUDEOIL';
            toast('🔄 Reloading MCX expiries...');
            fetchCommodityExpiries(cname);
        }

        function openNewCommodityStrategyForm() {
            document.getElementById('commodityStrategyForm').reset();
            document.getElementById('commodityEditId').value = '';
            document.getElementById('commodityFormTitle').textContent = '➕ Create New MCX Commodity Strategy';
            onCommodityUnderlyingChange();
            toggleCardCollapse('commodityFormCollapseContent', 'commodityFormChevron', true);
            const formCard = document.getElementById('commodityFormCard');
            if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function cancelCommodityEditForm() {
            document.getElementById('commodityStrategyForm').reset();
            document.getElementById('commodityEditId').value = '';
            toggleCardCollapse('commodityFormCollapseContent', 'commodityFormChevron', false);
        }

        function toggleCommodityHistoryTable() {
            const container = document.getElementById('commHistoryContainer');
            if (container) {
                container.style.display = container.style.display === 'none' ? 'block' : 'none';
            }
        }

        function downloadCommodityPnlCsv() {
            toast('📥 Downloading commodity_PnL.csv...');
            window.location.href = '/api/commodity/pnl/download';
        }

        async function fetchCommodityPnlSummary() {
            try {
                const res = await api('/api/commodity/pnl/summary');
                if (res.status === 'ok') {
                    commodityPnlSummaryData = res;
                    const tradesBadge = document.getElementById('commJournalTradesBadge');
                    if (tradesBadge) tradesBadge.textContent = `${res.total_trades || 0} Trades`;
                    const pnlBadge = document.getElementById('commRealizedPnlBadge');
                    if (pnlBadge) {
                        const rp = parseFloat(res.realized_pnl || 0);
                        pnlBadge.textContent = `P&L: ${formatPnl(rp)}`;
                        pnlBadge.className = `status-badge ${getPnlClass(rp)}`;
                    }

                    const tbody = document.getElementById('commHistoryBody');
                    if (tbody && res.records && res.records.length > 0) {
                        tbody.innerHTML = res.records.map((r, idx) => `
                            <tr>
                                <td>${idx + 1}</td>
                                <td>${r.Date || '--'}</td>
                                <td><b>${r.Strategy_Name || '--'}</b></td>
                                <td><span class="badge badge-instrument">${r.Instrument || '--'}</span></td>
                                <td><b>${r.Leg || '--'}</b></td>
                                <td><code>${r.Symbol || '--'}</code></td>
                                <td><span class="badge ${r.Action === 'BUY' ? 'badge-buy' : 'badge-sell'}">${r.Action || '--'}</span></td>
                                <td>${r.Lot_Size || 1}</td>
                                <td>₹${parseFloat(r.Actual_Entry_Price || 0).toFixed(2)}</td>
                                <td>${parseFloat(r.Actual_Exit_Price || 0) > 0 ? '₹' + parseFloat(r.Actual_Exit_Price).toFixed(2) : '--'}</td>
                                <td class="${getPnlClass(parseFloat(r.Day_PnL || 0))}">${formatPnl(parseFloat(r.Day_PnL || 0))}</td>
                                <td class="${getPnlClass(parseFloat(r.Cumulative_PnL || 0))}">${formatPnl(parseFloat(r.Cumulative_PnL || 0))}</td>
                                <td><span style="font-size: 11px; color: var(--text-secondary);">${r.Exit_Reason || '--'}</span></td>
                                <td><span class="status-pill ${r.Status === 'CLOSED' ? 'status-closed' : 'status-open'}">${r.Status || 'OPEN'}</span></td>
                            </tr>
                        `).join('');
                    }
                }
            } catch (e) {
                console.error('Error fetching commodity PnL summary:', e);
            }
        }

        async function fetchCommodityStatus(silent = false) {
            try {
                const res = await api('/api/commodity/status');
                if (res.status === 'ok') {
                    loadedCommodityStrategies = res.strategies || [];
                    renderCommodityStrategies(loadedCommodityStrategies);

                    // Update logs terminal
                    const terminal = document.getElementById('commLogsTerminal');
                    if (terminal && res.logs && res.logs.length > 0) {
                        terminal.innerHTML = res.logs.map(l => `<div class="log-line">${l}</div>`).join('');
                        terminal.scrollTop = terminal.scrollHeight;
                    }
                    const lastSync = document.getElementById('commLastChecked');
                    if (lastSync) lastSync.textContent = `Sync: ${new Date().toLocaleTimeString()}`;

                    // Update main status badge
                    const activeCount = loadedCommodityStrategies.filter(s => s.active).length;
                    const commBadge = document.getElementById('commStatusBadge');
                    if (commBadge) {
                        if (activeCount > 0) {
                            commBadge.textContent = `${activeCount} Active`;
                            commBadge.style.background = '#dcfce7';
                            commBadge.style.color = '#15803d';
                        } else {
                            commBadge.textContent = 'MCX Idle';
                            commBadge.style.background = '#fef3c7';
                            commBadge.style.color = '#b45309';
                        }
                    }
                }
            } catch (e) {
                if (!silent) console.error('Error fetching commodity status:', e);
            }
        }

        async function saveCommodityStrategy(e) {
            e.preventDefault();
            const editId = document.getElementById('commodityEditId').value;
            const cname = document.getElementById('commCommodityName').value || 'CRUDEOIL';
            const stype = document.getElementById('commStrategyType').value || 'STRADDLE';
            const sname = document.getElementById('commStratName').value || `${cname} Strategy`;
            const action = document.getElementById('commEntryAction').value || 'SELL';
            const expiry = document.getElementById('commExpirySelect').value || 'CURRENT';
            const product = document.getElementById('commProduct').value || 'MIS';
            const cePrem = parseFloat(document.getElementById('commCePremium').value) || 0;
            const pePrem = parseFloat(document.getElementById('commPePremium').value) || 0;
            const slType = document.getElementById('commSlType').value || 'POINTS';
            const slVal = parseFloat(document.getElementById('commSlValue').value) || 30;
            const reentryCount = parseInt(document.getElementById('commReentryCount').value) || 0;
            const enableTsl = document.getElementById('commEnableTsl').checked;
            const tslStep = parseFloat(document.getElementById('commTslStep').value) || 10;
            const tslVal = parseFloat(document.getElementById('commTslVal').value) || 10;
            const quantity = parseInt(document.getElementById('commQuantity').value) || getCommodityLotSize(cname);
            const startTime = document.getElementById('commStartTime').value || '09:15:00';
            const endTime = document.getElementById('commEndTime').value || '23:15:00';

            const payload = {
                id: editId || undefined,
                name: sname,
                commodity_name: cname,
                strategy_type: stype,
                entry_action: action,
                expiry: expiry,
                product: product,
                ce_premium: cePrem,
                pe_premium: pePrem,
                sl_type: slType,
                sl_value: slVal,
                sl_points: slVal,
                reentry_count: reentryCount,
                enable_tsl: enableTsl,
                tsl_step: tslStep,
                tsl_value: tslVal,
                tsl_points: tslVal,
                quantity: quantity,
                start_time: startTime,
                end_time: endTime,
                active: false,
                status: 'Idle'
            };

            try {
                const res = await api('/api/commodity/strategies', 'POST', payload);
                if (res.status === 'ok') {
                    toast('✅ Commodity Strategy Saved!');
                    cancelCommodityEditForm();
                    fetchCommodityStatus();
                } else {
                    toast('❌ ' + (res.message || 'Error saving strategy'), true);
                }
            } catch (err) {
                toast('❌ Failed saving strategy: ' + err.message, true);
            }
        }

        function editCommodityStrategy(stratId) {
            const s = loadedCommodityStrategies.find(x => x.id === stratId);
            if (!s) return;

            document.getElementById('commodityEditId').value = s.id;
            document.getElementById('commCommodityName').value = s.commodity_name || 'CRUDEOIL';
            document.getElementById('commStrategyType').value = s.strategy_type || 'STRADDLE';
            document.getElementById('commStratName').value = s.name || '';
            document.getElementById('commEntryAction').value = s.entry_action || 'SELL';
            document.getElementById('commProduct').value = s.product || 'MIS';
            document.getElementById('commCePremium').value = s.ce_premium || 0;
            document.getElementById('commPePremium').value = s.pe_premium || 0;
            document.getElementById('commSlType').value = s.sl_type || 'POINTS';
            document.getElementById('commSlValue').value = s.sl_value || s.sl_points || 30;
            document.getElementById('commReentryCount').value = s.reentry_count || 0;
            document.getElementById('commEnableTsl').checked = Boolean(s.enable_tsl);
            document.getElementById('commTslStep').value = s.tsl_step || 10;
            document.getElementById('commTslVal').value = s.tsl_value || s.tsl_points || 10;
            document.getElementById('commQuantity').value = s.quantity || getCommodityLotSize(s.commodity_name);
            document.getElementById('commStartTime').value = s.start_time || '09:15:00';
            document.getElementById('commEndTime').value = s.end_time || '23:15:00';

            onCommodityTypeChange();
            toggleCommodityTslFields();
            fetchCommodityExpiries(s.commodity_name);
            setTimeout(() => {
                if (s.expiry) document.getElementById('commExpirySelect').value = s.expiry;
            }, 300);

            document.getElementById('commodityFormTitle').textContent = `✏️ Edit Strategy: ${s.name}`;
            toggleCardCollapse('commodityFormCollapseContent', 'commodityFormChevron', true);
            const formCard = document.getElementById('commodityFormCard');
            if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        async function toggleCommodityStrategy(stratId, newActive) {
            const res = await api(`/api/commodity/strategies/${stratId}/toggle`, 'POST', { active: newActive });
            if (res.status === 'ok') {
                toast(newActive ? '🚀 Commodity Strategy Activated' : '🛑 Strategy Stopped & Squared Off');
                fetchCommodityStatus();
            } else {
                toast('❌ Failed toggling strategy', true);
            }
        }

        const commodityCollapsedCards = new Set();
        function toggleCommodityCard(stratId) {
            if (commodityCollapsedCards.has(stratId)) {
                commodityCollapsedCards.delete(stratId);
            } else {
                commodityCollapsedCards.add(stratId);
            }
            const body = document.getElementById(`stratCardBody_${stratId}`);
            const chev = document.getElementById(`stratCardChevron_${stratId}`);
            if (body) {
                const isNowHidden = commodityCollapsedCards.has(stratId);
                body.style.display = isNowHidden ? 'none' : 'block';
                if (chev) chev.className = `strat-card-chevron ${isNowHidden ? 'collapsed' : ''}`;
            }
        }

        async function calculateCommodityStrategy(stratId) {
            toast('🔍 Calculating Commodity Strikes & LTPs...');
            try {
                const res = await api(`/api/commodity/strategies/${stratId}/calculate`, 'POST');
                if (res.status === 'ok') {
                    toast('✅ ' + (res.message || 'Strikes calculated successfully'));
                    if (res.strategy) {
                        const idx = loadedCommodityStrategies.findIndex(x => x.id === stratId);
                        if (idx !== -1) {
                            loadedCommodityStrategies[idx] = res.strategy;
                        } else {
                            loadedCommodityStrategies.push(res.strategy);
                        }
                        renderCommodityStrategies(loadedCommodityStrategies);
                    }
                    fetchCommodityStatus(true);
                } else {
                    toast('❌ ' + (res.message || 'Calculation failed'), true);
                }
            } catch (e) {
                toast('❌ Calculation error: ' + e.message, true);
            }
        }

        async function forceEnterCommodityStrategy(stratId) {
            const s = loadedCommodityStrategies.find(x => x.id === stratId);
            if (!confirm(`Place live entry orders now for '${s ? s.name : stratId}'?`)) return;
            toast('🚀 Placing Commodity Entry Orders...');
            try {
                const res = await api(`/api/commodity/strategies/${stratId}/enter`, 'POST');
                if (res.status === 'ok') {
                    toast('✅ ' + (res.message || 'Orders placed successfully'));
                    fetchCommodityStatus();
                } else {
                    toast('❌ ' + (res.message || 'Order execution failed'), true);
                }
            } catch (e) {
                toast('❌ Order execution error: ' + e.message, true);
            }
        }

        async function squareoffCommodityStrategy(stratId) {
            const s = loadedCommodityStrategies.find(x => x.id === stratId);
            if (!confirm(`Are you sure you want to square off '${s ? s.name : stratId}'?`)) return;
            toast('⚡ Squaring off Commodity Strategy...');
            try {
                const res = await api(`/api/commodity/strategies/${stratId}/squareoff`, 'POST');
                if (res.status === 'ok') {
                    toast('✅ ' + (res.message || 'Squareoff complete'));
                    fetchCommodityStatus();
                } else {
                    toast('❌ ' + (res.message || 'Squareoff failed'), true);
                }
            } catch (e) {
                toast('❌ Squareoff error: ' + e.message, true);
            }
        }

        async function deleteCommodityStrategy(stratId) {
            const s = loadedCommodityStrategies.find(x => x.id === stratId);
            if (!confirm(`Delete commodity strategy '${s ? s.name : stratId}'?`)) return;
            const res = await api(`/api/commodity/strategies/${stratId}`, 'DELETE');
            if (res.status === 'ok') {
                toast('Strategy Deleted');
                fetchCommodityStatus();
            }
        }

        function renderCommodityStrategies(strategies) {
            const container = document.getElementById('commInstrumentGroupsContainer');
            if (!container) return;

            if (!strategies || strategies.length === 0) {
                container.innerHTML = `
                    <div class="card" style="text-align: center; padding: 36px 20px;">
                        <div style="font-size: 32px; margin-bottom: 12px;">🛢️</div>
                        <h3 style="font-size: 16px; font-weight: 800; color: var(--text-primary); margin-bottom: 6px;">No Commodity Strategies Configured</h3>
                        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">Create your first automated MCX Options or Futures strategy to start trading.</p>
                        <button onclick="openNewCommodityStrategyForm()" class="btn-primary" style="background-color: #d97706; border-color: #b45309; padding: 8px 18px;">
                            ➕ Create Commodity Strategy
                        </button>
                    </div>
                `;
                return;
            }

            // Group by commodity underlying
            const groups = {};
            strategies.forEach(s => {
                const cname = s.commodity_name || 'CRUDEOIL';
                if (!groups[cname]) groups[cname] = [];
                groups[cname].push(s);
            });

            container.innerHTML = Object.entries(groups).map(([cname, strats]) => {
                const groupActiveCount = strats.filter(s => s.active).length;
                const lotSize = getCommodityLotSize(cname);

                const cardsHtml = strats.map(s => {
                    const isActive = Boolean(s.active);
                    const statusClass = isActive ? 'connected' : 'disconnected';
                    const statusText = s.status || (isActive ? 'Running' : 'Idle');
                    const action = (s.entry_action || 'SELL').toUpperCase();
                    const actionBadge = action === 'BUY'
                        ? `<span style="background: #e6f4ea; color: #137333; border: 1px solid #ceead6; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">🟢 BUY</span>`
                        : `<span style="background: #fce8e6; color: #c5221f; border: 1px solid #fad2cf; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">🔴 SELL</span>`;

                    const isCollapsed = commodityCollapsedCards.has(s.id);
                    const orders = s.orders || {};
                    let totalPnl = 0;
                    const legRows = [];

                    ['FUT', 'CE', 'PE'].forEach(legKey => {
                        const leg = orders[legKey];
                        if (leg && leg.symbol) {
                            const pnl = parseFloat(leg.pnl || 0);
                            totalPnl += pnl;
                            legRows.push(`
                                <tr>
                                    <td style="font-weight: 700; color: #b45309; padding: 6px 10px;">${legKey}</td>
                                    <td style="font-family: monospace; font-weight: 700; padding: 6px 10px;">${leg.symbol}</td>
                                    <td style="font-family: monospace; padding: 6px 10px;">₹${parseFloat(leg.entry_price || 0).toFixed(2)}</td>
                                    <td style="font-family: monospace; font-weight: 700; padding: 6px 10px;">₹${parseFloat(leg.current_ltp || 0).toFixed(2)}</td>
                                    <td style="font-family: monospace; color: #dc2626; font-weight: 700; padding: 6px 10px;">₹${parseFloat(leg.current_sl_trigger || 0).toFixed(2)}</td>
                                    <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800; padding: 6px 10px;" class="${getPnlClass(pnl)}">${formatPnl(pnl)}</td>
                                </tr>
                            `);
                        }
                    });

                    // Expiry Formatting
                    let expText = s.resolved_expiry;
                    if (!expText) {
                        expText = (s.expiry && s.expiry !== 'CURRENT' && s.expiry !== 'NEAREST' && s.expiry !== '--') ? s.expiry : 'Nearest Expiry';
                    }

                    // Sizing Formatting
                    const qty = parseInt(s.quantity) || lotSize;
                    const lotsCount = Math.max(1, Math.round(qty / lotSize));
                    const sizingText = `Qty: ${qty} (${lotsCount} Lot${lotsCount > 1 ? 's' : ''}, Lot Size: ${lotSize})`;

                    // Strikes Box HTML
                    let strikesBoxHtml = '';
                    if (s.selected_ce || s.selected_pe || s.future_symbol) {
                        strikesBoxHtml = `
                            <div style="margin-bottom: 12px; padding: 12px 14px; background: #fffbeb; border-radius: 8px; border: 1.5px solid #fde68a; font-size: 12px; box-shadow: var(--shadow-sm);">
                                <div style="font-weight: 800; color: #b45309; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                                    <span style="font-size: 13px;">📍 Live Calculated MCX Contracts &amp; Option Strikes</span>
                                    ${s.future_symbol ? `<span style="background: #ffffff; padding: 2px 8px; border-radius: 4px; border: 1px solid #fde68a; font-family: monospace; color: #92400e; font-weight: 700;">Fut: ${s.future_symbol} (₹${parseFloat(s.future_ltp || 0).toFixed(2)})</span>` : ''}
                                </div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px;">
                                    ${s.selected_ce ? `
                                    <div style="background: #ffffff; padding: 8px 12px; border-radius: 6px; border: 1px solid #dcfce7; display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <span style="font-size: 10px; font-weight: 800; color: #16a34a; text-transform: uppercase; display: block;">CE Option Strike</span>
                                            <span style="font-family: monospace; font-size: 13px; font-weight: 800; color: var(--text-primary);">${s.selected_ce}</span>
                                        </div>
                                        <div style="text-align: right;">
                                            <span style="font-size: 10px; font-weight: 800; color: var(--text-secondary); display: block;">Live LTP</span>
                                            <span style="font-family: monospace; font-size: 14px; font-weight: 800; color: #15803d;">₹${parseFloat(s.selected_ce_ltp || 0).toFixed(2)}</span>
                                        </div>
                                    </div>` : ''}
                                    ${s.selected_pe ? `
                                    <div style="background: #ffffff; padding: 8px 12px; border-radius: 6px; border: 1px solid #fef3c7; display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <span style="font-size: 10px; font-weight: 800; color: #d97706; text-transform: uppercase; display: block;">PE Option Strike</span>
                                            <span style="font-family: monospace; font-size: 13px; font-weight: 800; color: var(--text-primary);">${s.selected_pe}</span>
                                        </div>
                                        <div style="text-align: right;">
                                            <span style="font-size: 10px; font-weight: 800; color: var(--text-secondary); display: block;">Live LTP</span>
                                            <span style="font-family: monospace; font-size: 14px; font-weight: 800; color: #b45309;">₹${parseFloat(s.selected_pe_ltp || 0).toFixed(2)}</span>
                                        </div>
                                    </div>` : ''}
                                </div>
                            </div>
                        `;
                    } else {
                        strikesBoxHtml = `
                            <div style="margin-bottom: 12px; padding: 10px 14px; background: #fffbeb; border-radius: 6px; border: 1px dashed #fde68a; font-size: 11px; color: #b45309; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                <span style="font-weight: 700;">🎯 Strikes not calculated — click 🔍 Calc to preview strikes &amp; LTPs</span>
                                <button type="button" onclick="calculateCommodityStrategy('${s.id}')" class="btn-secondary" style="padding: 4px 10px; font-size: 11px; background: #ffffff; color: #b45309; font-weight: 800;">
                                    🔍 Calculate Strikes
                                </button>
                            </div>
                        `;
                    }

                    // Header strikes badge
                    let headerStrikesBadge = '';
                    if (s.selected_ce || s.selected_pe) {
                        headerStrikesBadge = `
                            <span style="background: #fffbeb; color: #92400e; border: 1px solid #fde68a; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; font-family: monospace; display: inline-flex; align-items: center; gap: 6px;" title="Selected Strikes">
                                ${s.selected_ce ? `<span style="color: #15803d;">CE: <b>${s.selected_ce}</b> (₹${parseFloat(s.selected_ce_ltp || 0).toFixed(2)})</span>` : ''}
                                ${s.selected_ce && s.selected_pe ? `<span style="color: #f59e0b;">|</span>` : ''}
                                ${s.selected_pe ? `<span style="color: #b45309;">PE: <b>${s.selected_pe}</b> (₹${parseFloat(s.selected_pe_ltp || 0).toFixed(2)})</span>` : ''}
                            </span>
                        `;
                    }

                    return `
                    <div class="card strat-card" data-strat-id="${s.id}" data-group-id="${cname}" style="border-top: 3px solid ${isActive ? 'var(--success)' : '#f59e0b'}; padding: 0; margin-bottom: 12px;">
                        <!-- Collapsible Header Summary Strip -->
                        <div class="strat-card-header" onclick="toggleCommodityCard('${s.id}')">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span id="stratCardChevron_${s.id}" class="strat-card-chevron ${isCollapsed ? 'collapsed' : ''}">▼</span>
                                <span style="font-size: 14px; font-weight: 800; color: var(--text-primary);">${s.name || 'Commodity Strategy'}</span>
                                <span style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 4px;">🛢️ ${cname}</span>
                                <span style="background: #ffffff; color: var(--text-secondary); border: 1px solid var(--border-color); font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;">${s.strategy_type} (${s.product || 'MIS'})</span>
                                ${actionBadge}
                                <span style="background: #faf5ff; color: #6b21a8; border: 1px solid #e9d5ff; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">${sizingText}</span>
                                <span class="status-pill ${statusClass}" style="margin: 0; padding: 2px 8px; font-size: 10px;">
                                    <span class="status-dot"></span>
                                    <span>${statusText}</span>
                                </span>
                            </div>

                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                ${headerStrikesBadge}
                                <span style="background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; font-family: monospace;" title="Expiry Date">
                                    📅 ${expText}
                                </span>
                                <span style="background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; font-family: monospace;" title="MCX Schedule">
                                    ⏰ ${s.start_time || '09:15'} - ${s.end_time || '23:15'}
                                </span>
                                <div style="display: flex; align-items: center; gap: 5px;">
                                    <span style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">Live P&amp;L:</span>
                                    <span class="${getPnlClass(totalPnl)}" style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 800; padding: 2px 8px; border-radius: 6px; background: #ffffff; border: 1px solid var(--border-color); white-space: nowrap;">${formatPnl(totalPnl)}</span>
                                </div>

                                <!-- Full-size Quick Action Buttons -->
                                <div style="display: flex; gap: 6px; align-items: center;" onclick="event.stopPropagation()">
                                    <button onclick="toggleCommodityStrategy('${s.id}', ${!isActive})" class="${isActive ? 'btn-danger' : 'btn-primary'}" style="padding: 4px 10px; font-size: 11px; width: auto;">
                                        ${isActive ? '⏹️ Stop' : '▶️ Start'}
                                    </button>
                                    <button onclick="calculateCommodityStrategy('${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto; font-weight: 700;" title="Calculate strikes &amp; fetch live LTPs">🔍 Calc</button>
                                    <button onclick="forceEnterCommodityStrategy('${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto; color: #16a34a; border-color: rgba(22, 163, 74, 0.4);" title="Force Enter Orders Now">🚀 Enter</button>
                                    <button onclick="squareoffCommodityStrategy('${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto; color: var(--error); border-color: rgba(203, 83, 78, 0.4);" title="Exit Strategy">⚡ Exit</button>
                                    <button onclick="editCommodityStrategy('${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto;" title="Edit Strategy">✏️ Edit</button>
                                    <button onclick="deleteCommodityStrategy('${s.id}')" class="btn-secondary" style="padding: 4px 8px; font-size: 11px; width: auto; color: var(--error);" title="Delete Strategy">🗑️</button>
                                </div>
                            </div>
                        </div>

                        <!-- Collapsible Body Content -->
                        <div id="stratCardBody_${s.id}" class="strat-card-body" style="display: ${isCollapsed ? 'none' : 'block'}; padding: 14px 18px 18px 18px; border-top: 1px solid var(--border-color);">
                            <!-- Strategy Metadata & Parameters Bar -->
                            <div style="background: #f8fafc; padding: 10px 14px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 10px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                                <div>
                                    <span style="color: var(--text-secondary); font-weight: 600;">⏰ Execution Window:</span>
                                    <span style="font-family: monospace; font-weight: 700; color: #9a3412;"> ${s.start_time || '09:15:00'} ➔ ${s.end_time || '23:15:00'}</span>
                                </div>
                                <div>
                                    <span style="color: var(--text-secondary); font-weight: 600;">🛑 Risk Control:</span>
                                    <span style="font-weight: 700; color: #dc2626;"> SL: ${s.sl_value || 30} ${s.sl_type || 'POINTS'}</span>
                                    <span style="font-weight: 700; color: #0284c7; margin-left: 6px;">| TSL: ${s.enable_tsl ? `ON (${s.tsl_value || 10} pts)` : 'OFF'}</span>
                                </div>
                                <div>
                                    <span style="color: var(--text-secondary); font-weight: 600;">🔄 Re-entries:</span>
                                    <span style="font-weight: 700; color: #6b21a8;"> ${s.reentry_count || 0} allowed</span>
                                </div>
                                <div>
                                    <span style="color: var(--text-secondary); font-weight: 600;">📦 Sizing:</span>
                                    <span style="font-weight: 700; color: #6b21a8;"> ${sizingText}</span>
                                </div>
                            </div>

                            <!-- Calculated Strikes Box -->
                            ${strikesBoxHtml}

                            <!-- Active Legs Position Table -->
                            <div style="margin-top: 10px;">
                                <div style="font-size: 11px; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 6px;">
                                    📋 Active Leg Orders &amp; Open Positions
                                </div>
                                ${legRows.length > 0 ? `
                                    <div style="overflow-x: auto; background: #ffffff; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                            <thead>
                                                <tr style="background: #f1f5f9; text-align: left; font-size: 10px; color: var(--text-secondary); text-transform: uppercase;">
                                                    <th style="padding: 6px 10px;">Leg</th>
                                                    <th style="padding: 6px 10px;">Contract Symbol</th>
                                                    <th style="padding: 6px 10px;">Entry Price</th>
                                                    <th style="padding: 6px 10px;">Live LTP</th>
                                                    <th style="padding: 6px 10px;">SL Trigger</th>
                                                    <th style="padding: 6px 10px;">Leg PnL</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${legRows.join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                ` : `
                                    <div style="padding: 12px; background: #ffffff; border: 1px dashed var(--border-color); border-radius: var(--radius-sm); text-align: center; color: var(--text-muted); font-size: 11px;">
                                        No active orders placed yet. Click <b>▶️ Start</b> to run scheduled entry or <b>🚀 Enter</b> to execute immediately.
                                    </div>
                                `}
                            </div>
                        </div>
                    </div>`;
                }).join('');

                return `
                <div style="margin-bottom: 24px; background: rgba(255,255,255,0.65); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 18px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #fed7aa; flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 20px;">🛢️</span>
                            <span style="font-size: 16px; font-weight: 800; color: #9a3412;">${cname} Strategies (${strats.length})</span>
                            <span style="background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">
                                Lot Size: ${lotSize}
                            </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 12px; font-weight: 700; color: var(--text-secondary);">
                                Active: <b style="color: #16a34a;">${groupActiveCount}</b> / ${strats.length}
                            </span>
                            <span class="tab-badge" style="background: #fef3c7; color: #b45309; font-weight: 800;">MCX (09:00 - 23:30)</span>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
                        ${cardsHtml}
                    </div>
                </div>`;
            }).join('');
        }

        // ═══════════════════════════════════════════════════════════════
        // TRADINGVIEW WEBHOOK & MULTI-LEG STRATEGY RULES MANAGER
        // ═══════════════════════════════════════════════════════════════

        let loadedTvRules = [];
        let isTvFormEditing = false;
        let activeTvAlertTab = 'BUY'; // 'BUY', 'SELL', or 'EXIT'
        let currentTvBuyLegs = [];
        let currentTvSellLegs = [];

        // Tab Switching for Alert Types
        function switchTvAlertTab(tab) {
            activeTvAlertTab = tab;
            const buyTabBtn = document.getElementById('tvTabBuyLegsBtn');
            const sellTabBtn = document.getElementById('tvTabSellLegsBtn');
            const exitTabBtn = document.getElementById('tvTabExitLegsBtn');
            const legBuilderPanel = document.getElementById('tvLegBuilderPanel');
            const exitConfigPanel = document.getElementById('tvExitConfigPanel');
            const buyLegsCont = document.getElementById('tvBuyLegsContainer');
            const sellLegsCont = document.getElementById('tvSellLegsContainer');
            const heading = document.getElementById('tvLegBuilderHeading');
            const addBtn = document.getElementById('tvAddLegBtn');

            [buyTabBtn, sellTabBtn, exitTabBtn].forEach(b => {
                if (b) {
                    b.classList.remove('active');
                    b.style.background = '#f8fafc';
                    b.style.color = '#64748b';
                    b.style.borderColor = '#cbd5e1';
                }
            });

            if (tab === 'BUY') {
                if (buyTabBtn) {
                    buyTabBtn.classList.add('active');
                    buyTabBtn.style.background = '#ecfdf5';
                    buyTabBtn.style.color = '#166534';
                    buyTabBtn.style.borderColor = '#16a34a';
                }
                if (legBuilderPanel) legBuilderPanel.style.display = 'block';
                if (exitConfigPanel) exitConfigPanel.style.display = 'none';
                if (buyLegsCont) buyLegsCont.style.display = 'block';
                if (sellLegsCont) sellLegsCont.style.display = 'none';
                if (heading) heading.innerHTML = `➕ Add Leg for <span style="color: #16a34a;">BUY Alert</span>`;
                if (addBtn) {
                    addBtn.innerHTML = `➕ Add Leg to BUY Alert`;
                    addBtn.style.background = 'linear-gradient(135deg, #059669, #047857)';
                }
            } else if (tab === 'SELL') {
                if (sellTabBtn) {
                    sellTabBtn.classList.add('active');
                    sellTabBtn.style.background = '#fef2f2';
                    sellTabBtn.style.color = '#991b1b';
                    sellTabBtn.style.borderColor = '#dc2626';
                }
                if (legBuilderPanel) legBuilderPanel.style.display = 'block';
                if (exitConfigPanel) exitConfigPanel.style.display = 'none';
                if (buyLegsCont) buyLegsCont.style.display = 'none';
                if (sellLegsCont) sellLegsCont.style.display = 'block';
                if (heading) heading.innerHTML = `➕ Add Leg for <span style="color: #dc2626;">SELL Alert</span>`;
                if (addBtn) {
                    addBtn.innerHTML = `➕ Add Leg to SELL Alert`;
                    addBtn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
                }
            } else if (tab === 'EXIT') {
                if (exitTabBtn) {
                    exitTabBtn.classList.add('active');
                    exitTabBtn.style.background = '#fffbeb';
                    exitTabBtn.style.color = '#92400e';
                    exitTabBtn.style.borderColor = '#f59e0b';
                }
                if (legBuilderPanel) legBuilderPanel.style.display = 'none';
                if (exitConfigPanel) exitConfigPanel.style.display = 'block';
                if (buyLegsCont) buyLegsCont.style.display = 'block';
                if (sellLegsCont) sellLegsCont.style.display = 'block';
            }
        }

        // Pill Button Selector
        function setTvPill(param, value) {
            const hiddenInput = document.getElementById(`tvLeg_${param}`);
            if (hiddenInput) hiddenInput.value = value;

            let group = document.getElementById(`tvPillGroup_${param}`);
            if (param === 'category') {
                const autoGroup = document.getElementById('tvPillGroup_category_autostrike');
                const regGroup = document.getElementById('tvPillGroup_category_regular');
                group = autoGroup && autoGroup.style.display !== 'none' ? autoGroup : regGroup;
            }

            if (group) {
                const btns = group.querySelectorAll('.tv-pill-btn');
                btns.forEach(b => {
                    if (b.getAttribute('data-value') === value) {
                        b.classList.add('active');
                    } else {
                        b.classList.remove('active');
                    }
                });
            }

            // Variety-driven dynamic display
            if (param === 'variety') {
                const isAuto = (value === 'AUTOSTRIKEPRICE' || value === 'FULLY ALGO');
                const autoContainer = document.getElementById('tvAutoStrikeParamsContainer');
                const expiryContainer = document.getElementById('tvLeg_expiry_container');
                const autoCatGroup = document.getElementById('tvPillGroup_category_autostrike');
                const regCatGroup = document.getElementById('tvPillGroup_category_regular');

                if (autoContainer) autoContainer.style.display = isAuto ? 'block' : 'none';
                if (expiryContainer) expiryContainer.style.display = isAuto ? 'block' : 'none';
                if (autoCatGroup && regCatGroup) {
                    if (isAuto) {
                        autoCatGroup.style.display = 'flex';
                        regCatGroup.style.display = 'none';
                        setTvPill('category', 'FULLY ALGO AUTOSTRIKE');
                    } else {
                        autoCatGroup.style.display = 'none';
                        regCatGroup.style.display = 'flex';
                        setTvPill('category', 'MARKET');
                    }
                }
            }
        }

        function toggleCustomInstrumentInput() {
            const row = document.getElementById('tvCustomInstInputRow');
            if (row) {
                const isHidden = row.style.display === 'none' || !row.style.display;
                row.style.display = isHidden ? 'flex' : 'none';
                if (isHidden) {
                    const input = document.getElementById('tvCustomInstInput');
                    if (input) input.focus();
                }
            }
        }

        function ensureInstrumentInDropdown(instName) {
            if (!instName) return;
            const upper = instName.trim().toUpperCase();
            const datalist = document.getElementById('tvLeg_instrument_list');
            if (datalist) {
                let found = false;
                for (let i = 0; i < datalist.options.length; i++) {
                    if (datalist.options[i].value === upper) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    const opt = document.createElement('option');
                    opt.value = upper;
                    opt.textContent = upper;
                    datalist.appendChild(opt);
                }
            }

            const instInput = document.getElementById('tvLeg_instrument');
            if (instInput && instInput.tagName === 'SELECT') {
                let found = false;
                for (let i = 0; i < instInput.options.length; i++) {
                    if (instInput.options[i].value === upper) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    const opt = document.createElement('option');
                    opt.value = upper;
                    opt.textContent = upper;
                    instInput.appendChild(opt);
                }
            }
        }

        async function onTvLegInstrumentChange() {
            const inst = (document.getElementById('tvLeg_instrument')?.value || '').trim().toUpperCase();
            const expirySelect = document.getElementById('tvLeg_expiry');
            if (!inst || !expirySelect) return;

            const baseOptions = `
                <option value="CURRENT_WEEK" selected>⚡ Current Weekly (or Monthly if weekly unavailable)</option>
                <option value="NEXT_WEEK">📅 Next Weekly</option>
                <option value="CURRENT_MONTH">📆 Current Monthly</option>
                <option value="NEXT_MONTH">🗓️ Next Monthly</option>
            `;

            try {
                const res = await api(`/api/expiries?index=${inst}`);
                const dates = Array.isArray(res) ? res : (res?.dates || res?.expiries || []);
                if (dates.length > 0) {
                    let opts = baseOptions;
                    opts += `<optgroup label="Direct Expiry Dates">`;
                    dates.forEach(d => {
                        opts += `<option value="${d}">${d}</option>`;
                    });
                    opts += `</optgroup>`;
                    expirySelect.innerHTML = opts;
                } else {
                    expirySelect.innerHTML = baseOptions;
                }
            } catch (e) {
                expirySelect.innerHTML = baseOptions;
            }
        }

        function addCurrentLegToActiveTab() {
            const variety = document.getElementById('tvLeg_variety')?.value || 'REGULAR';
            const isAuto = (variety === 'AUTOSTRIKEPRICE' || variety === 'FULLY ALGO');
            const category = document.getElementById('tvLeg_category')?.value || (isAuto ? 'FULLY ALGO AUTOSTRIKE' : 'MARKET');
            const exchange = document.getElementById('tvLeg_exchange')?.value || 'NFO';
            const product = document.getElementById('tvLeg_product')?.value || 'NRML';
            const transition = document.getElementById('tvLeg_transition')?.value || 'BUY';
            const instrument = document.getElementById('tvLeg_instrument')?.value || 'NIFTY';
            const expiry = isAuto ? (document.getElementById('tvLeg_expiry')?.value || 'CURRENT_WEEK') : '';
            const qtyMode = document.getElementById('tvLeg_qty_mode')?.value || 'QTY';
            const lots = parseInt(document.getElementById('tvLeg_lots')?.value) || 1;
            const fixedQty = parseInt(document.getElementById('tvLeg_fixed_qty')?.value) || 0;
            const inOutMoney = isAuto ? (parseInt(document.getElementById('tvLeg_in_out_money')?.value) || 0) : 0;
            const minusPlus = isAuto ? (document.getElementById('tvLeg_minus_plus')?.value || '0') : '0';
            const optionType = isAuto ? (document.getElementById('tvLeg_option_type')?.value || 'CE') : '';
            const nearby = isAuto ? (document.getElementById('tvLeg_nearby')?.value || 'AUTO') : 'AUTO';

            const leg = {
                id: `leg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                variety: variety,
                order_category: category,
                exchange: exchange,
                product: product,
                transition_type: transition,
                instrument: instrument,
                qty_or_fund: qtyMode,
                lots: lots,
                quantity: fixedQty
            };

            if (isAuto) {
                leg.expiry = expiry;
                leg.in_out_money = inOutMoney;
                leg.minus_or_plus = minusPlus;
                leg.option_type = optionType;
                leg.nearby = nearby;
            }

            if (activeTvAlertTab === 'BUY') {
                currentTvBuyLegs.push(leg);
                toast(`➕ Added leg to BUY alert (${currentTvBuyLegs.length} total)`);
            } else if (activeTvAlertTab === 'SELL') {
                currentTvSellLegs.push(leg);
                toast(`➕ Added leg to SELL alert (${currentTvSellLegs.length} total)`);
            }
            renderConfiguredLegsLists();
        }

        function removeLegFromActiveTab(actionType, index) {
            if (actionType === 'BUY') {
                currentTvBuyLegs.splice(index, 1);
                toast('🗑️ Leg removed from BUY alert');
            } else if (actionType === 'SELL') {
                currentTvSellLegs.splice(index, 1);
                toast('🗑️ Leg removed from SELL alert');
            }
            renderConfiguredLegsLists();
        }

        function renderConfiguredLegsLists() {
            // Update Tab counts
            const buyCountEl = document.getElementById('tvBuyLegsCount');
            const sellCountEl = document.getElementById('tvSellLegsCount');
            const buyListCountEl = document.getElementById('tvBuyLegsListCount');
            const sellListCountEl = document.getElementById('tvSellLegsListCount');
            if (buyCountEl) buyCountEl.textContent = currentTvBuyLegs.length;
            if (sellCountEl) sellCountEl.textContent = currentTvSellLegs.length;
            if (buyListCountEl) buyListCountEl.textContent = currentTvBuyLegs.length;
            if (sellListCountEl) sellListCountEl.textContent = currentTvSellLegs.length;

            const buyList = document.getElementById('tvBuyLegsList');
            const sellList = document.getElementById('tvSellLegsList');

            const renderList = (legs, actionType) => {
                if (!legs || legs.length === 0) {
                    return `<div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 10px; border: 1px dashed #cbd5e1; border-radius: 4px;">
                        No legs added for ${actionType} alert yet. Use the form above and click 'Add Leg'.
                    </div>`;
                }

                return legs.map((leg, idx) => {
                    const isAuto = (leg.variety === 'AUTOSTRIKEPRICE' || leg.variety === 'FULLY ALGO');
                    const strikeBadge = isAuto ?
                        `<span style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px;">
                            ${leg.minus_or_plus === '0' ? 'ATM' : (leg.minus_or_plus === '+' ? `+${leg.in_out_money} OTM` : `-${leg.in_out_money} ITM`)} ${leg.option_type || ''}
                        </span>` :
                        `<span style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">${leg.variety || 'REGULAR'}</span>`;

                    const optColor = leg.option_type === 'CE' ? '#15803d' : '#b91c1c';
                    const transColor = leg.transition_type === 'BUY' ? '#16a34a' : '#dc2626';
                    const optBadge = (isAuto && leg.option_type) ? `<span style="font-weight: 700; color: ${optColor};">${leg.option_type}</span>` : '';
                    const expBadge = (isAuto && leg.expiry) ? `<span style="font-size: 10px; color: var(--text-secondary);">${leg.expiry}</span>` : '';

                    return `
                    <div class="tv-leg-card" style="display: flex; justify-content: space-between; align-items: center; background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid ${transColor}; border-radius: 4px; padding: 8px 12px; font-size: 11px;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="font-weight: 800; color: #475569;">#${idx + 1}</span>
                            <span style="background: #f8fafc; font-weight: 800; color: ${transColor}; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px;">${leg.transition_type}</span>
                            <b style="font-family: monospace; font-size: 12px;">${leg.instrument}</b>
                            ${strikeBadge}
                            ${optBadge}
                            ${expBadge}
                            <span style="background: #faf5ff; color: #6b21a8; border: 1px solid #e9d5ff; font-weight: 700; padding: 1px 6px; border-radius: 4px;">${leg.exchange}:${leg.product}</span>
                            <span style="font-weight: 800; font-family: monospace;">${leg.quantity > 0 ? `${leg.quantity} Qty` : `${leg.lots} Lot(s)`}</span>
                            <span style="font-size: 10px; color: #64748b; background: #f1f5f9; padding: 1px 5px; border-radius: 3px;">${leg.order_category}</span>
                        </div>
                        <div style="display: flex; gap: 4px;">
                            <button type="button" onclick="loadLegIntoForm('${actionType}', ${idx})" class="btn-secondary" style="padding: 2px 6px; font-size: 11px; color: #2563eb;" title="Edit Leg in Form">✏️</button>
                            <button type="button" onclick="removeLegFromActiveTab('${actionType}', ${idx})" class="btn-secondary" style="padding: 2px 6px; font-size: 11px; color: #dc2626;" title="Remove Leg">✕</button>
                        </div>
                    </div>`;
                }).join('');
            };

            if (buyList) buyList.innerHTML = renderList(currentTvBuyLegs, 'BUY');
            if (sellList) sellList.innerHTML = renderList(currentTvSellLegs, 'SELL');
        }

        function loadLegIntoForm(actionType, index) {
            const list = actionType === 'BUY' ? currentTvBuyLegs : currentTvSellLegs;
            const leg = list && list[index];
            if (!leg) return;

            setTvPill('variety', leg.variety || 'REGULAR');
            setTvPill('category', leg.order_category || 'MARKET');
            setTvPill('exchange', leg.exchange || 'NFO');
            setTvPill('product', leg.product || 'NRML');
            setTvPill('transition', leg.transition_type || actionType);

            const instInput = document.getElementById('tvLeg_instrument');
            if (instInput) {
                instInput.value = leg.instrument || 'NIFTY';
                ensureInstrumentInDropdown(leg.instrument);
            }

            const expirySelect = document.getElementById('tvLeg_expiry');
            if (expirySelect && leg.expiry) {
                expirySelect.value = leg.expiry;
            }

            const qtyModeEl = document.getElementById('tvLeg_qty_mode');
            if (qtyModeEl && leg.qty_or_fund) qtyModeEl.value = leg.qty_or_fund;

            const lotsEl = document.getElementById('tvLeg_lots');
            if (lotsEl) lotsEl.value = leg.lots || 1;

            const fixedQtyEl = document.getElementById('tvLeg_fixed_qty');
            if (fixedQtyEl) fixedQtyEl.value = leg.quantity || 0;

            const inOutEl = document.getElementById('tvLeg_in_out_money');
            if (inOutEl && leg.in_out_money !== undefined) inOutEl.value = String(leg.in_out_money);

            setTvPill('minus_plus', leg.minus_or_plus || '0');
            if (leg.option_type) setTvPill('option_type', leg.option_type);

            const nearbyEl = document.getElementById('tvLeg_nearby');
            if (nearbyEl && leg.nearby) nearbyEl.value = leg.nearby;

            switchTvAlertTab(actionType);
            toast(`📋 Loaded Leg #${index + 1} (${leg.instrument}) into form for editing`);
        }

        async function fetchTvStatus(force = false) {
            try {
                const res = await api('/api/tv/status');
                if (!res || res.status !== 'ok') {
                    // Fallback directly to strategies endpoint
                    const stratRes = await api('/api/tv/strategies');
                    if (stratRes && stratRes.strategies) {
                        loadedTvRules = stratRes.strategies;
                        renderTvRulesTable(loadedTvRules);
                        updateTvTestDropdown(loadedTvRules);
                    }
                    return;
                }

                const cfg = res.config || {};
                const st = res.status || {};
                loadedTvRules = res.strategies || [];
                const logs = res.logs || [];

                // 1. Immediately Render Strategy Rules Table (Priority 1)
                renderTvRulesTable(loadedTvRules);
                updateTvTestDropdown(loadedTvRules);

                // 2. Populate any custom instruments into dropdown
                try {
                    (loadedTvRules || []).forEach(r => {
                        if (r && r.instrument) ensureInstrumentInDropdown(r.instrument);
                        if (r && Array.isArray(r.buy_legs)) r.buy_legs.forEach(l => { if (l && l.instrument) ensureInstrumentInDropdown(l.instrument); });
                        if (r && Array.isArray(r.sell_legs)) r.sell_legs.forEach(l => { if (l && l.instrument) ensureInstrumentInDropdown(l.instrument); });
                    });
                } catch (e) {
                    console.warn('Instrument dropdown populate warning:', e);
                }

                // 3. Update Webhook URL input & Previous URLs dropdown
                try {
                    const urlInput = document.getElementById('tvWebhookUrlInput');
                    const prevSelect = document.getElementById('tvPreviousUrlsSelect');
                    const targetUrl = cfg.webhook_url || 'http://127.0.0.1:80';

                    if (urlInput && document.activeElement !== urlInput) {
                        urlInput.value = targetUrl;
                    }

                    if (prevSelect) {
                        const history = (cfg.previous_webhook_urls && cfg.previous_webhook_urls.length > 0) 
                            ? cfg.previous_webhook_urls 
                            : [targetUrl, 'http://127.0.0.1:3000'];
                        
                        // Ensure current targetUrl is in list
                        const uniqueHistory = Array.from(new Set([targetUrl, ...history]));
                        prevSelect.innerHTML = uniqueHistory.map(u => 
                            `<option value="${u}" ${u === targetUrl ? 'selected' : ''}>${u}</option>`
                        ).join('');
                    }
                } catch (e) {}

                // 4. Update Webhook Connection Badge
                try {
                    const connBadge = document.getElementById('tvConnBadge');
                    if (connBadge) {
                        if (st.connected) {
                            connBadge.textContent = '🟢 CONNECTED';
                            connBadge.style.background = '#dcfce7';
                            connBadge.style.color = '#166534';
                            connBadge.style.borderColor = '#bbf7d0';
                        } else {
                            connBadge.textContent = '🔴 DISCONNECTED';
                            connBadge.style.background = '#fee2e2';
                            connBadge.style.color = '#991b1b';
                            connBadge.style.borderColor = '#fecaca';
                        }
                    }
                } catch (e) {}

                // 5. Update Poller & Stats Banner
                try {
                    const engineBadge = document.getElementById('tvEngineRunningBadge');
                    if (engineBadge) {
                        if (res.engine_running && cfg.enabled) {
                            engineBadge.textContent = 'POLLER ACTIVE';
                            engineBadge.style.background = '#dcfce7';
                            engineBadge.style.color = '#166534';
                            engineBadge.style.borderColor = '#bbf7d0';
                        } else {
                            engineBadge.textContent = 'PAUSED';
                            engineBadge.style.background = '#fef3c7';
                            engineBadge.style.color = '#b45309';
                            engineBadge.style.borderColor = '#fde68a';
                        }
                    }

                    const lastPollEl = document.getElementById('tvLastPollTime');
                    if (lastPollEl) lastPollEl.textContent = st.last_poll_time || 'Just now';

                    const queueCountEl = document.getElementById('tvPendingQueueCount');
                    if (queueCountEl) queueCountEl.textContent = `${st.pending_alerts_count || 0} in Queue`;

                    const totalExecEl = document.getElementById('tvTotalExecutedVal');
                    if (totalExecEl) totalExecEl.textContent = st.total_executed || 0;

                    const activeRulesCount = loadedTvRules.filter(r => r.active !== false).length;
                    const rulesBadge = document.getElementById('tvRulesCountBadge');
                    if (rulesBadge) rulesBadge.textContent = `${activeRulesCount} Active / ${loadedTvRules.length}`;

                    const tabBadge = document.getElementById('tvStatusBadge');
                    if (tabBadge) {
                        if (st.connected) {
                            tabBadge.textContent = `🟢 ${st.pending_alerts_count || 0} Alerts`;
                            tabBadge.style.background = '#dcfce7';
                            tabBadge.style.color = '#166534';
                        } else {
                            tabBadge.textContent = '🔴 Offline';
                            tabBadge.style.background = '#fee2e2';
                            tabBadge.style.color = '#991b1b';
                        }
                    }

                    const js = res.journal_summary || {};
                    const jTotalBadge = document.getElementById('tvJournalTotalTradesBadge');
                    if (jTotalBadge) jTotalBadge.textContent = `${js.total_trades || 0} Recorded Trades`;

                    const jTodayBadge = document.getElementById('tvJournalTodayTradesBadge');
                    if (jTodayBadge) jTodayBadge.textContent = `Today: ${js.today_trades || 0}`;

                    const dupBadge = document.getElementById('tvDupPreventedBadge');
                    if (dupBadge) dupBadge.textContent = `${st.total_duplicates_prevented || 0} Duplicates Blocked`;
                    // 6. Check for newly received UNMATCHED strategy alerts and popup an immediate warning toast
                    if (logs && logs.length > 0) {
                        const latestLog = logs[logs.length - 1];
                        if (latestLog && latestLog.status === 'NO_MATCHING_STRATEGY') {
                            const alertKey = `unmatched_${latestLog.alert_id || latestLog.id || latestLog.timestamp}`;
                            if (!window._lastNotifiedUnmatched || window._lastNotifiedUnmatched !== alertKey) {
                                window._lastNotifiedUnmatched = alertKey;
                                toast(`⚠️ UNMATCHED TV ALERT: Strategy '${latestLog.strategy}' (${latestLog.action} ${latestLog.instrument || ''}) received but NO strategy rule found!`, 'error');
                            }
                        }
                    }

                    // 7. Render Logs Table & Live Terminal Stream
                    renderTvLogsTable(logs);

                    const tvTerminal = document.getElementById('tvLogsTerminal');
                    const tvLastSync = document.getElementById('tvLogsLastSync');
                    if (tvLastSync) tvLastSync.textContent = `Sync: ${new Date().toLocaleTimeString()}`;
                    if (tvTerminal && logs && logs.length > 0) {
                        tvTerminal.innerHTML = logs.map(l => {
                            const isErr = l.status === 'NO_MATCHING_STRATEGY' || l.status === 'ERROR' || l.status === 'FAILED';
                            const isWarn = l.status === 'PARTIAL' || l.status === 'SKIPPED';
                            const color = isErr ? '#f87171' : (isWarn ? '#fbbf24' : '#4ade80');
                            const prefix = isErr ? '❌ [MISMATCH/ERROR]' : (isWarn ? '⚠️ [NOTICE]' : '✅ [EXECUTED]');
                            return `<div class="log-line" style="color: ${color}; padding: 2px 0;">
                                <span style="color: #94a3b8;">${l.timestamp || ''}</span> 
                                <b>${prefix}</b> 
                                [${l.strategy || 'DEFAULT'}] ${l.action || ''} ${l.symbol || l.instrument || ''} 
                                ➔ ${l.message || l.details || l.status || ''}
                            </div>`;
                        }).join('');
                        tvTerminal.scrollTop = tvTerminal.scrollHeight;
                    }

            } catch (err) {
                console.error('Error fetching TV status:', err);
            }
        }

        function downloadTvJournal(format = 'xlsx') {
            const url = `/api/tv/journal/download?format=${format}`;
            toast(format === 'xlsx' ? '📊 Downloading Multi-Sheet Excel Journal...' : '📥 Downloading CSV Journal...');
            window.location.href = url;
        }

        function resetTvRuleForm() {
            document.getElementById('tvRuleEditId').value = '';
            document.getElementById('tvRuleStratName').value = '';
            document.getElementById('tvRuleDescription').value = '';
            document.getElementById('tvRuleFormTitle').textContent = '🛠️ TradingView Multi-Leg Strategy Maker';

            setTvPill('variety', 'AUTOSTRIKEPRICE');
            setTvPill('category', 'FULLY ALGO AUTOSTRIKE');
            setTvPill('exchange', 'NFO');
            setTvPill('product', 'NRML');
            setTvPill('transition', 'BUY');
            setTvPill('minus_plus', '0');
            setTvPill('option_type', 'CE');

            document.getElementById('tvLeg_instrument').value = 'NIFTY';
            document.getElementById('tvLeg_expiry').value = 'CURRENT_WEEK';
            document.getElementById('tvLeg_qty_mode').value = 'QTY';
            document.getElementById('tvLeg_lots').value = '1';
            document.getElementById('tvLeg_fixed_qty').value = '0';
            document.getElementById('tvLeg_in_out_money').value = '0';
            document.getElementById('tvLeg_nearby').value = 'AUTO';

            currentTvBuyLegs = [];
            currentTvSellLegs = [];
            switchTvAlertTab('BUY');
            renderConfiguredLegsLists();
            onTvLegInstrumentChange();
            isTvFormEditing = false;
        }

        function editTvStrategyRule(ruleId) {
            const rule = loadedTvRules.find(r => r.id === ruleId);
            if (!rule) return;

            document.getElementById('tvRuleEditId').value = rule.id || '';
            document.getElementById('tvRuleStratName').value = rule.strategy_name || '';
            document.getElementById('tvRuleDescription').value = rule.description || '';
            document.getElementById('tvRuleFormTitle').textContent = `✏️ Edit Strategy: ${rule.strategy_name || 'DEFAULT'}`;

            if (document.getElementById('tvRuleExitMode') && rule.exit_mode) {
                document.getElementById('tvRuleExitMode').value = rule.exit_mode;
            }

            // Hydrate Buy & Sell Legs (supporting legacy single-leg rules)
            if (rule.buy_legs && Array.isArray(rule.buy_legs) && rule.buy_legs.length > 0) {
                currentTvBuyLegs = JSON.parse(JSON.stringify(rule.buy_legs));
            } else if (rule.mode || rule.instrument) {
                // Synthesize legacy rule into a leg
                const inst = rule.instrument || 'NIFTY';
                ensureInstrumentInDropdown(inst);
                currentTvBuyLegs = [{
                    id: `leg_buy_1`,
                    variety: rule.mode === 'ATM_OPTION' ? 'AUTOSTRIKEPRICE' : 'REGULAR',
                    order_category: 'FULLY ALGO AUTOSTRIKE',
                    exchange: rule.exchange || 'NFO',
                    product: rule.product || 'NRML',
                    transition_type: 'BUY',
                    instrument: inst,
                    expiry: rule.expiry || 'CURRENT_WEEK',
                    qty_or_fund: 'QTY',
                    lots: rule.lots || 1,
                    quantity: rule.quantity || 0,
                    in_out_money: 0,
                    minus_or_plus: '0',
                    option_type: rule.option_type === 'AUTO' ? 'CE' : (rule.option_type || 'CE'),
                    nearby: rule.round_off || 'AUTO'
                }];
            } else {
                currentTvBuyLegs = [];
            }

            if (rule.sell_legs && Array.isArray(rule.sell_legs) && rule.sell_legs.length > 0) {
                currentTvSellLegs = JSON.parse(JSON.stringify(rule.sell_legs));
            } else if (rule.mode || rule.instrument) {
                // Synthesize legacy sell leg
                const inst = rule.instrument || 'NIFTY';
                ensureInstrumentInDropdown(inst);
                currentTvSellLegs = [{
                    id: `leg_sell_1`,
                    variety: rule.mode === 'ATM_OPTION' ? 'AUTOSTRIKEPRICE' : 'REGULAR',
                    order_category: 'FULLY ALGO AUTOSTRIKE',
                    exchange: rule.exchange || 'NFO',
                    product: rule.product || 'NRML',
                    transition_type: 'SELL',
                    instrument: inst,
                    expiry: rule.expiry || 'CURRENT_WEEK',
                    qty_or_fund: 'QTY',
                    lots: rule.lots || 1,
                    quantity: rule.quantity || 0,
                    in_out_money: 0,
                    minus_or_plus: '0',
                    option_type: rule.option_type === 'AUTO' ? 'PE' : (rule.option_type || 'PE'),
                    nearby: rule.round_off || 'AUTO'
                }];
            } else {
                currentTvSellLegs = [];
            }

            switchTvAlertTab('BUY');
            renderConfiguredLegsLists();

            // Auto-populate the active form inputs with the 1st leg so user sees full configuration immediately
            const firstLeg = (currentTvBuyLegs.length > 0) ? currentTvBuyLegs[0] : (currentTvSellLegs.length > 0 ? currentTvSellLegs[0] : null);
            if (firstLeg) {
                const actionForFirstLeg = (currentTvBuyLegs.length > 0) ? 'BUY' : 'SELL';
                loadLegIntoForm(actionForFirstLeg, 0);
            }

            isTvFormEditing = true;
            toggleCardCollapse('tvRuleFormCollapseContent', 'tvRuleFormChevron', true);
            document.getElementById('tvRuleStratName').focus();
        }

        async function saveTvStrategyRule(e) {
            if (e) e.preventDefault();
            const editId = document.getElementById('tvRuleEditId').value.trim();
            const stratName = document.getElementById('tvRuleStratName').value.trim();
            if (!stratName) {
                toast('⚠️ Strategy Name is required', 'warning');
                return;
            }

            if (currentTvBuyLegs.length === 0 && currentTvSellLegs.length === 0) {
                if (!confirm('You have not added any legs for BUY or SELL alerts yet. Save anyway?')) {
                    return;
                }
            }

            const rulePayload = {
                id: editId || `rule_${Date.now()}`,
                strategy_name: stratName,
                description: document.getElementById('tvRuleDescription').value.trim(),
                buy_legs: currentTvBuyLegs,
                sell_legs: currentTvSellLegs,
                exit_mode: document.getElementById('tvRuleExitMode')?.value || 'SQUAREOFF_ALL',
                active: true
            };

            try {
                const res = await api('/api/tv/strategies', 'POST', rulePayload);
                if (res.status === 'ok') {
                    toast(`✅ Saved strategy '${stratName}' with ${currentTvBuyLegs.length} BUY / ${currentTvSellLegs.length} SELL legs`);
                    resetTvRuleForm();
                    toggleCardCollapse('tvRuleFormCollapseContent', 'tvRuleFormChevron', false);
                    fetchTvStatus(true);
                }
            } catch (err) {
                toast('❌ Failed to save strategy rule', 'error');
            }
        }

        function renderTvRulesTable(rules) {
            const tbody = document.getElementById('tvRulesTableBody');
            if (!tbody) return;

            if (!rules || rules.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">No strategies configured yet. Click '➕ New Strategy' to configure one.</td></tr>`;
                return;
            }

            try {
                tbody.innerHTML = rules.map(r => {
                    const isActive = r.active !== false;
                    let buyLegs = r.buy_legs || [];
                    let sellLegs = r.sell_legs || [];

                    // Backward-compatibility: Synthesize legs for display if legacy rule structure
                    if (buyLegs.length === 0 && sellLegs.length === 0 && (r.mode || r.instrument)) {
                        const inst = r.instrument || 'NIFTY';
                        const size = r.quantity > 0 ? `${r.quantity} Qty` : `${r.lots || 1}L`;
                        const modeDesc = r.mode === 'ATM_OPTION' ? 'ATM OPTION' : 'DIRECT';
                        buyLegs = [{ transition_type: 'BUY', instrument: inst, in_out_money: 0, minus_or_plus: '0', option_type: r.option_type || 'CE', lots: r.lots, quantity: r.quantity }];
                        sellLegs = [{ transition_type: 'SELL', instrument: inst, in_out_money: 0, minus_or_plus: '0', option_type: r.option_type || 'PE', lots: r.lots, quantity: r.quantity }];
                    }

                    const formatLegsPill = (legs, colorHex) => {
                        if (!legs || legs.length === 0) {
                            return `<span style="color: var(--text-muted); font-size: 11px;">(None)</span>`;
                        }
                        return legs.map(l => {
                            const isAuto = (l.variety === 'AUTOSTRIKEPRICE' || l.variety === 'FULLY ALGO');
                            const offset = isAuto ? ((l.minus_or_plus === '0' || !l.minus_or_plus) ? 'ATM' : `${l.minus_or_plus || ''}${l.in_out_money || 0}`) : '';
                            const opt = (isAuto && l.option_type) ? `${l.option_type}` : '';
                            const size = (l.quantity && Number(l.quantity) > 0) ? `${l.quantity} Qty` : `${l.lots || 1}L`;
                            const details = [offset, opt].filter(Boolean).join(' ');
                            return `<div style="margin-bottom: 2px;">
                                <span style="background: ${colorHex}15; color: ${colorHex}; border: 1px solid ${colorHex}40; font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 4px; display: inline-block;">
                                    ${l.transition_type || 'BUY'} ${l.instrument || ''} ${details ? details + ' ' : ''}(${size}) [${l.exchange || 'NFO'}:${l.product || 'NRML'}]
                                </span>
                            </div>`;
                        }).join('');
                    };

                    const buyLegsHtml = formatLegsPill(buyLegs, '#16a34a');
                    const sellLegsHtml = formatLegsPill(sellLegs, '#dc2626');
                    const exitHtml = `<span style="background: #fffbeb; color: #92400e; border: 1px solid #fde68a; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">⚡ Square Off All</span>`;

                    return `
                    <tr style="${!isActive ? 'opacity: 0.6; background: rgba(0,0,0,0.01);' : ''}">
                        <td>
                            <label class="switch" style="transform: scale(0.8); margin: 0;">
                                <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleTvStrategyRule('${r.id}')">
                                <span class="slider round"></span>
                            </label>
                        </td>
                        <td>
                            <b style="font-size: 12px; color: var(--text-primary);">${r.strategy_name || 'DEFAULT'}</b>
                        </td>
                        <td>${buyLegsHtml}</td>
                        <td>${sellLegsHtml}</td>
                        <td>${exitHtml}</td>
                        <td><span style="font-size:11px; color:var(--text-secondary);">${r.description || '--'}</span></td>
                        <td>
                            <div style="display:flex; gap:6px;">
                                <button onclick="editTvStrategyRule('${r.id}')" class="btn-secondary" style="padding:3px 8px; font-size:11px;" title="Edit Strategy">✏️</button>
                                <button onclick="deleteTvStrategyRule('${r.id}')" class="btn-secondary" style="padding:3px 8px; font-size:11px; color:#dc2626;" title="Delete Strategy">🗑️</button>
                            </div>
                        </td>
                    </tr>`;
                }).join('');
            } catch (err) {
                console.error('Error rendering TV rules table:', err);
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#dc2626; padding:15px;">⚠️ Error rendering strategy list: ${err.message}</td></tr>`;
            }
        }

        async function deleteTvStrategyRule(ruleId) {
            const rule = loadedTvRules.find(r => r.id === ruleId);
            const name = rule ? rule.strategy_name : ruleId;
            if (!confirm(`Are you sure you want to delete strategy rule '${name}'?`)) return;

            try {
                const res = await api(`/api/tv/strategies/${ruleId}`, 'DELETE');
                if (res.status === 'ok') {
                    toast(`🗑️ Strategy '${name}' deleted`);
                    fetchTvStatus(true);
                }
            } catch (err) {
                toast('❌ Failed to delete rule', 'error');
            }
        }

        async function toggleTvStrategyRule(ruleId) {
            try {
                const res = await api(`/api/tv/strategies/${ruleId}/toggle`, 'POST');
                if (res.status === 'ok') {
                    const updated = res.updated;
                    const st = updated && updated.active ? 'Activated' : 'Paused';
                    toast(`Strategy '${updated ? updated.strategy_name : ''}' ${st}`);
                    fetchTvStatus(true);
                }
            } catch (err) {
                toast('❌ Failed to toggle strategy status', 'error');
            }
        }

        function onTvTestStrategyChange() {
            const stratSelect = document.getElementById('tvTestStrategySelect');
            const instInput = document.getElementById('tvTestInstInput');
            if (!stratSelect || !instInput) return;
            const stratName = stratSelect.value;
            const rule = (loadedTvRules || []).find(r => (r.strategy_name || '').trim().toLowerCase() === stratName.trim().toLowerCase());
            if (rule) {
                let inst = rule.instrument || '';
                if (!inst && rule.buy_legs && rule.buy_legs.length > 0) {
                    inst = rule.buy_legs[0].instrument;
                }
                if (!inst && rule.sell_legs && rule.sell_legs.length > 0) {
                    inst = rule.sell_legs[0].instrument;
                }
                if (inst) {
                    instInput.value = inst;
                    return;
                }
            }
            if (stratName === 'DEFAULT') {
                instInput.value = 'NIFTY';
            }
        }

        function updateTvTestDropdown(rules) {
            const stratSelect = document.getElementById('tvTestStrategySelect');
            if (!stratSelect) return;
            const curVal = stratSelect.value;
            let names = ['DEFAULT'];
            (rules || []).forEach(r => {
                if (r.strategy_name && !names.includes(r.strategy_name)) {
                    names.push(r.strategy_name);
                }
            });
            stratSelect.innerHTML = names.map(n => `<option value="${n}" ${n === curVal ? 'selected' : ''}>${n}</option>`).join('');
            onTvTestStrategyChange();
        }

        function renderTvLogsTable(logs) {
            const tbody = document.getElementById('tvLogsTableBody');
            const countBadge = document.getElementById('tvLogCountBadge');
            if (!tbody) return;

            if (countBadge) {
                countBadge.textContent = `${(logs || []).length} Executions`;
            }

            if (!logs || logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 20px;">No TradingView alerts received yet. Alerts will appear here in real-time.</td></tr>`;
                return;
            }

            tbody.innerHTML = logs.slice(0, 50).map(l => {
                const isSuccess = l.status === 'SUCCESS' || l.status === 'EXECUTED' || l.status === 'PROCESSED';
                const statusColor = isSuccess ? '#16a34a' : '#dc2626';
                const statusBg = isSuccess ? '#dcfce7' : '#fee2e2';
                const actionColor = (l.action || '').includes('BUY') ? '#16a34a' : ((l.action || '').includes('SELL') ? '#dc2626' : '#d97706');

                return `
                <tr>
                    <td style="font-family: monospace; font-size: 11px; white-space: nowrap;">${l.timestamp || '--'}</td>
                    <td style="font-family: monospace; font-size: 10px; color: var(--text-secondary);">${l.alert_id || l.id || '--'}</td>
                    <td><b style="color: #1e40af;">${l.strategy || l.strategy_name || 'DEFAULT'}</b></td>
                    <td><span style="font-weight: 800; color: ${actionColor}; font-size: 11px;">${l.action || '--'}</span></td>
                    <td><b style="font-family: monospace; font-size: 12px;">${l.symbol || l.tradingsymbol || '--'}</b></td>
                    <td style="font-family: monospace; font-weight: 700;">${l.quantity || l.qty || '--'}</td>
                    <td><span style="font-size: 10px; font-weight: 700; color: #64748b;">${l.product || 'MIS'}</span></td>
                    <td style="font-family: monospace; font-size: 11px;">${l.order_id || l.kite_order_id || '--'}</td>
                    <td>
                        <span style="background: ${statusBg}; color: ${statusColor}; font-weight: 800; font-size: 10px; padding: 2px 7px; border-radius: 4px;">
                            ${l.status || 'OK'}
                        </span>
                    </td>
                    <td style="font-size: 11px; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${l.message || l.details || ''}">
                        ${l.message || l.details || '--'}
                    </td>
                </tr>`;
            }).join('');
        }

        function onTvSelectPreviousUrl(selectedUrl) {
            if (!selectedUrl) return;
            const input = document.getElementById('tvWebhookUrlInput');
            if (input) {
                input.value = selectedUrl;
                saveTvConfig();
            }
        }

        async function saveTvConfig() {
            const input = document.getElementById('tvWebhookUrlInput');
            let url = input ? input.value.trim() : '';
            if (!url) {
                toast('⚠️ Webhook URL cannot be empty');
                return;
            }
            // Auto add http:// if missing protocol
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'http://' + url;
                if (input) input.value = url;
            }
            try {
                const res = await api('/api/tv/config', 'POST', { webhook_url: url, enabled: true });
                if (res.status === 'ok') {
                    toast('✅ Webhook URL saved: ' + url);
                    await fetchTvStatus(true);
                } else {
                    toast('⚠️ ' + (res.message || 'Could not save configuration'));
                }
            } catch (e) {
                toast('❌ Failed to save TV config');
            }
        }

        async function clearTvPendingQueue() {
            try {
                toast('🧹 Clearing waiting alerts from queue...');
                const res = await api('/api/tv/clear_pending', 'POST');
                if (res.status === 'ok') {
                    toast(`✅ ${res.message || 'Alert queue cleared'}`);
                    fetchTvStatus(true);
                } else {
                    toast(`⚠️ ${res.message || 'Failed to clear queue'}`);
                }
            } catch (e) {
                toast('❌ Error connecting to server');
            }
        }

        async function toggleTvEngine(enable) {
            try {
                const res = await api('/api/tv/engine/toggle', 'POST', { enabled: enable });
                if (res.status === 'ok') {
                    toast(enable ? '🚀 TV Webhook Poller Resumed' : '🛑 TV Webhook Poller Paused');
                    fetchTvStatus(true);
                }
            } catch (e) {
                toast('❌ Failed to toggle engine', 'error');
            }
        }

        async function simulateTvAlert() {
            const strat = document.getElementById('tvTestStrategySelect').value;
            const action = document.getElementById('tvTestActionSelect').value;
            const inst = document.getElementById('tvTestInstInput').value.trim() || 'NIFTY';

            toast(`⚡ Simulating ${action} alert for ${strat} (${inst})...`);
            try {
                const res = await api('/api/tv/test_alert', 'POST', {
                    strategy: strat,
                    instrument: inst,
                    action: action,
                    ltp: 0.0
                });
                if (res.status === 'ok') {
                    toast(`✅ ${res.message || `Test Alert Executed for '${strat}'`}`);
                } else {
                    toast(`⚠️ ${res.message || 'Execution failed'}`, 'error');
                }
                fetchTvStatus(true);
            } catch (err) {
                toast(`❌ Test alert failed: ${err.message || err}`, 'error');
            }
        }

        (async function init() {
            initWindowCollapseStates();
            initStraddleGreekToggles();
            await loadCredentials();
            // Pre-fetch all saved strategies immediately from local disk so cards are rendered on launch
            fetchAndRenderStrategies();
            fetchPosStrangleStatus(true);
            fetchStraddleStatus(true);
            fetchCommodityStatus(true);
            fetchCommodityPnlSummary();
            fetchTvStatus(true);

            // Check if URL has request_token or access_token from Zerodha redirect
            const urlParams = new URLSearchParams(window.location.search);
            const queryToken = urlParams.get('request_token') || urlParams.get('access_token');
            if (queryToken) {
                toast('⚡ Completing login from Zerodha authorization...');
                try {
                    const res = await api('/api/login/access-token', 'POST', { access_token: queryToken });
                    if (res.status === 'ok') {
                        toast('✅ Connected successfully to Zerodha Kite!');
                        window.history.replaceState({}, document.title, window.location.pathname);
                        showDashboard(res.user_name);
                        return;
                    } else {
                        toast('❌ ' + (res.message || 'Authorization failed'), true);
                    }
                } catch (e) {
                    console.error("Token auth error:", e);
                }
            }

            const res = await api('/api/login/status');
            if (res.logged_in) {
                showDashboard(res.user_name);
            } else {
                // Attempt fast auto-login using today's cached token
                try {
                    const autoRes = await api('/api/login/auto', 'POST');
                    if (autoRes.status === 'ok') {
                        toast('✅ Automatically reconnected with cached session');
                        showDashboard(autoRes.user_name);
                    }
                } catch (e) { }
            }
        })();

    
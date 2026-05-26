import { eventSource, event_types, chat_metadata, getCurrentChatId, saveSettingsDebounced } from '../../../../script.js';
import { saveMetadataDebounced, extension_settings, getContext } from '../../../extensions.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const MODULE_NAME = 'wordCount';

/** Display modes — click to cycle */
const MODES = ['words', 'tokens'];
let currentMode = 'words';

/** Load persisted mode from extension_settings */
function loadMode() {
    if (extension_settings[MODULE_NAME]?.mode && MODES.includes(extension_settings[MODULE_NAME].mode)) {
        currentMode = extension_settings[MODULE_NAME].mode;
    }
}

/** Save current mode to extension_settings */
function saveMode() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    extension_settings[MODULE_NAME].mode = currentMode;
    saveSettingsDebounced();
}

/** Guard against overlapping async token calculations */
let tokenCalcGeneration = 0;

/**
 * Check if VerseManager's archive store is available (optional integration, no hard dependency)
 */
function getArchiveStore() {
    return window.VerseManager?.archiveStore || null;
}

/**
 * Count words in text
 */
function countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Initialize chat metadata
 */
function initMetadata() {
    if (!chat_metadata[MODULE_NAME]) {
        chat_metadata[MODULE_NAME] = {
            visible: true,
            count: 0
        };
        saveMetadataDebounced();
    }
}

/**
 * Get visibility state
 */
function isVisible() {
    initMetadata();
    return chat_metadata[MODULE_NAME].visible;
}

/**
 * Set visibility state
 */
function setVisible(visible) {
    initMetadata();
    chat_metadata[MODULE_NAME].visible = visible;
    saveMetadataDebounced();
    updateDisplay();
}

/**
 * Calculate and cache word count
 */
function calculateWordCount() {
    const context = SillyTavern.getContext();
    const chat = context.chat;
    
    if (!chat || chat.length === 0) {
        return 0;
    }
    
    let total = 0;
    
    chat.forEach(msg => {
        if (!msg.is_system) {
            total += countWords(msg.mes);
        }
    });
    
    // Cache it
    initMetadata();
    chat_metadata[MODULE_NAME].count = total;
    saveMetadataDebounced();
    
    return total;
}

/**
 * Calculate token count for the chat.
 * Uses ST's getTokenCountAsync which has its own internal cache by string hash,
 * so repeated calls for unchanged messages are essentially free lookups.
 * @returns {Promise<number>} Token count.
 */
async function calculateTokenCount() {
    const context = SillyTavern.getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        return 0;
    }

    // Collect all non-system message texts
    const texts = chat
        .filter(msg => !msg.is_system && msg.mes)
        .map(msg => msg.mes);

    if (texts.length === 0) return 0;

    // Sum token counts per message — ST's cache makes repeat calls cheap
    let total = 0;
    for (const text of texts) {
        total += await getTokenCountAsync(text);
    }

    return total;
}

/**
 * Update the display
 */
async function updateDisplay() {
    const $display = $('#word-count-display');
    
    if (!$display.length) return;

    // Hide when no chat is open
    if (!getCurrentChatId()) {
        $display.fadeOut(200);
        return;
    }
    
    const visible = isVisible();

    // Update visibility
    if (visible) {
        $display.fadeIn(200);
    } else {
        $display.fadeOut(200);
        return; // No point calculating if hidden
    }

    let count;

    if (currentMode === 'tokens') {
        // Async path — guard against stale results from overlapping calls
        const gen = ++tokenCalcGeneration;
        count = await calculateTokenCount();
        if (gen !== tokenCalcGeneration) return; // A newer call superseded us
    } else {
        count = calculateWordCount();
    }

    // Update text with animation
    const formatted = count.toLocaleString();
    const currentText = $display.find('.wc-number').text();
    
    if (currentText !== formatted) {
        $display.find('.wc-number').text(formatted);
        $display.addClass('wc-pulse');
        setTimeout(() => $display.removeClass('wc-pulse'), 300);
    }

    // Update the label to match current mode
    $display.find('.wc-label').text(currentMode);
}

/**
 * Update word count in VerseManager's archive store
 * (Only runs if VerseManager is installed)
 */
async function updateWordCountEntry() {
    const store = getArchiveStore();
    if (!store) return;
    
    try {
        const chatId = getCurrentChatId();
        
        if (!chatId) {
            console.log('[Word Count] No active chat, skipping archive store update');
            return;
        }
        
        const currentVerse = extension_settings?.verseManager?.currentVerse || 'default';
        
        // Load existing word count section (or start fresh)
        let wordCountData = {};
        try {
            wordCountData = await store.getSection(currentVerse, 'wordcount') || {};
        } catch (e) {
            console.warn('[Word Count] Failed to load existing data, starting fresh');
        }
        
        // Get current word count
        const currentCount = chat_metadata[MODULE_NAME]?.count || calculateWordCount();
        
        // Update with current chat's word count
        wordCountData[chatId] = currentCount;
        
        console.log(`[Word Count] Updated count for ${chatId}: ${currentCount} words (verse: ${currentVerse})`);
        
        // Save back to archive store (debounced)
        await store.saveSection(currentVerse, 'wordcount', wordCountData);
        console.log('[Word Count] Successfully saved to archive store');
        
    } catch (error) {
        console.error('[Word Count] Failed to update archive store:', error);
    }
}

/**
 * Cycle to the next display mode
 */
function cycleMode() {
    const idx = MODES.indexOf(currentMode);
    currentMode = MODES[(idx + 1) % MODES.length];
    saveMode();
    console.log(`[Word Count] Mode switched to: ${currentMode}`);
    updateDisplay();
}

/**
 * Create the display element
 */
function createDisplay() {
    const $display = $(`
        <div id="word-count-display">
            <div class="wc-content">
                <span class="wc-number">0</span>
                <span class="wc-label">words</span>
            </div>
        </div>
    `);
    
    $('body').append($display);

    // Click to cycle modes
    $display.on('click', cycleMode);
    
    // Set initial visibility
    if (!isVisible()) {
        $display.hide();
    }
    
    updateDisplay();
}

/**
 * Register slash command
 */
function registerSlashCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wordcount',
        callback: () => {
            const newState = !isVisible();
            setVisible(newState);
            toastr.info(`Word count ${newState ? 'shown' : 'hidden'}`);
            return '';
        },
        aliases: ['wc'],
        helpString: `
            <div>
                Toggle the word count display for the current chat. The visibility state persists per chat.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/wordcount</code></pre>
                        Shows or hides the word count display
                    </li>
                </ul>
            </div>
        `,
    }));
}

/**
 * Initialize extension
 */
jQuery(function() {
    console.log('[Word Count] Extension loaded');
    
    // Restore persisted mode
    loadMode();
    
    // Create display
    createDisplay();
    
    // Register events
    eventSource.on(event_types.MESSAGE_SENT, updateDisplay);
    eventSource.on(event_types.MESSAGE_RECEIVED, updateDisplay);
    eventSource.on(event_types.MESSAGE_DELETED, updateDisplay);
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        // Reset visibility for new chat
        updateDisplay();
        
        // Update archive store entry (if VerseManager installed)
        await updateWordCountEntry();
    });
    
    // Register slash command
    registerSlashCommand();
    
    // Initial update
    updateDisplay();
});
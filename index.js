import { eventSource, event_types, chat_metadata, getCurrentChatId } from '../../../../script.js';
import { saveMetadataDebounced, extension_settings, getContext } from '../../../extensions.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const MODULE_NAME = 'wordCount';

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
 * Update the display
 */
function updateDisplay() {
    const count = calculateWordCount();
    const visible = isVisible();
    
    const $display = $('#word-count-display');
    
    if (!$display.length) return;
    
    // Update text with animation
    const formatted = count.toLocaleString();
    const currentText = $display.find('.wc-number').text();
    
    if (currentText !== formatted) {
        $display.find('.wc-number').text(formatted);
        $display.addClass('wc-pulse');
        setTimeout(() => $display.removeClass('wc-pulse'), 300);
    }
    
    // Update visibility
    if (visible) {
        $display.fadeIn(200);
    } else {
        $display.fadeOut(200);
    }
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
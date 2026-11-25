(function () {
    'use strict';

    var storageKey = 'uaa-theme';
    var currentTheme = 'light';
    var storageAvailable = true;

    try {
        currentTheme = window.localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
    } catch (error) {
        storageAvailable = false;
        console.warn('Theme preference could not be read from local storage.', error);
    }

    function applyTheme(theme) {
        currentTheme = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
    }

    applyTheme(currentTheme);

    function addThemeToggle() {
        if (!document.body || document.getElementById('theme-toggle')) {
            return;
        }

        var button = document.createElement('button');
        var icon = document.createElement('span');
        var status = document.createElement('span');

        button.type = 'button';
        button.id = 'theme-toggle';
        button.className = 'theme-toggle';

        icon.className = 'theme-toggle-icon';
        icon.setAttribute('aria-hidden', 'true');
        status.className = 'theme-toggle-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        button.appendChild(icon);
        document.body.appendChild(button);
        document.body.appendChild(status);

        function updateButton() {
            var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            icon.textContent = currentTheme === 'dark' ? '\u2600' : '\u263E';
            button.setAttribute('aria-label', 'Switch to ' + nextTheme + ' mode');
            button.setAttribute('title', 'Switch to ' + nextTheme + ' mode');
        }

        button.addEventListener('click', function () {
            applyTheme(currentTheme === 'dark' ? 'light' : 'dark');

            try {
                window.localStorage.setItem(storageKey, currentTheme);
                storageAvailable = true;
                status.textContent = currentTheme === 'dark'
                    ? 'Dark mode enabled.'
                    : 'Light mode enabled.';
            } catch (error) {
                storageAvailable = false;
                console.warn('Theme preference could not be saved to local storage.', error);
                status.textContent = 'Theme changed for this page, but the preference could not be saved.';
            }

            updateButton();
        });

        updateButton();

        if (!storageAvailable) {
            status.textContent = 'Theme preference storage is unavailable; the selected mode may not persist.';
        }
    }

    window.addEventListener('storage', function (event) {
        if (event.key === storageKey && (event.newValue === 'light' || event.newValue === 'dark')) {
            applyTheme(event.newValue);
            var button = document.getElementById('theme-toggle');
            if (button) {
                button.setAttribute('aria-label', 'Switch to ' + (currentTheme === 'dark' ? 'light' : 'dark') + ' mode');
                button.setAttribute('title', 'Switch to ' + (currentTheme === 'dark' ? 'light' : 'dark') + ' mode');
                button.querySelector('.theme-toggle-icon').textContent = currentTheme === 'dark' ? '\u2600' : '\u263E';
            }
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addThemeToggle, { once: true });
    } else {
        addThemeToggle();
    }
})();

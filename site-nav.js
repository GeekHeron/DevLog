(function () {
    function initSharedNav() {
        var header = document.querySelector('header.site-header');
        if (!header) return;

        var oldButton = header.querySelector('.hamburger');
        var nav = header.querySelector('nav');
        var clock = header.querySelector('#clock');
        if (!oldButton || !nav) return;

        var button = oldButton.cloneNode(true);
        oldButton.parentNode.replaceChild(button, oldButton);

        function setOpen(isOpen) {
            button.classList.toggle('active', isOpen);
            nav.classList.toggle('active', isOpen);
            document.body.classList.toggle('site-nav-open', isOpen);
            button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            // 菜单打开时暂停粒子动画，关闭时恢复
            if (isOpen) {
                if (window.__pauseGalaxy) window.__pauseGalaxy();
            } else {
                if (window.__resumeGalaxy) window.__resumeGalaxy();
            }
        }

        window.toggleMenu = function () {
            setOpen(!button.classList.contains('active'));
        };

        button.addEventListener('click', function () {
            window.toggleMenu();
        });

        nav.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                setOpen(false);
            });
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') setOpen(false);
        });

        if (clock) {
            function updateClock() {
                var now = new Date();
                var format = function (unit) {
                    return String(unit).padStart(2, '0');
                };
                clock.textContent = 'T+' + format(now.getHours()) + ': ' + format(now.getMinutes()) + ': ' + format(now.getSeconds());
            }
            updateClock();
            setInterval(updateClock, 1000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSharedNav);
    } else {
        initSharedNav();
    }
})();

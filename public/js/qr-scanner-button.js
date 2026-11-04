// Floating QR Scanner Button Component for Students
(function() {
    // Only show on student pages
    const studentPages = ['/student/dashboard', '/student-dashboard', '/my-pc-station', '/student/scan-attendance'];
    const currentPath = window.location.pathname;
    const isStudentPage = studentPages.some(page => currentPath.includes(page) || currentPath === '/');

    if (!isStudentPage) return;

    // Create floating button
    const button = document.createElement('button');
    button.id = 'qr-scan-float-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Scan a QR code');
    button.title = 'Scan a QR code';
    button.innerHTML = '<i class="fas fa-qrcode"></i>';
    button.style.cssText = `
        position: fixed;
        bottom: calc(24px + env(safe-area-inset-bottom, 0px));
        right: 24px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #10b981, #059669);
        color: white;
        border: none;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        transition: all 0.3s ease;
        -webkit-tap-highlight-color: transparent;
    `;

    // Hover/Active effects
    button.onmouseover = () => {
        button.style.transform = 'scale(1.1)';
        button.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.5), 0 3px 6px rgba(0, 0, 0, 0.3)';
    };
    button.onmouseout = () => {
        button.style.transform = 'scale(1)';
        button.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2)';
    };

    // Create scanner modal
    const modal = document.createElement('div');
    modal.id = 'qr-scanner-modal';
    modal.style.cssText = `
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.95);
        z-index: 99999;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;

    modal.innerHTML = `
        <div style="position: relative; width: 100%; max-width: 500px;">
            <button id="close-scanner" style="
                position: absolute;
                top: -50px;
                right: 0;
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                font-size: 20px;
                cursor: pointer;
                z-index: 1;
            ">
                <i class="fas fa-times"></i>
            </button>
            
            <div id="qr-reader" style="width: 100%; border-radius: 12px; overflow: hidden;"></div>
            
            <div style="margin-top: 20px; text-align: center; color: white;">
                <p style="font-size: 18px; margin-bottom: 10px;">
                    <i class="fas fa-camera" style="margin-right: 8px;"></i>
                    Scan QR Code
                </p>
                <p style="font-size: 14px; color: rgba(255, 255, 255, 0.7);">
                    Point your camera at the attendance QR code
                </p>
            </div>
        </div>
    `;

    // Append elements
    document.body.appendChild(button);
    document.body.appendChild(modal);

    // Load QR scanner library
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    document.head.appendChild(script);

    let html5QrCode = null;

    // Open scanner
    button.onclick = async () => {
        modal.style.display = 'flex';

        // Wait for library to load
        if (typeof Html5Qrcode === 'undefined') {
            await new Promise(resolve => {
                script.onload = resolve;
            });
        }

        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("qr-reader");
        }

        try {
            await html5QrCode.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 }
                },
                (decodedText, decodedResult) => {
                    // QR Code detected!
                    console.log('QR Code detected:', decodedText);
                    
                    // Stop scanner
                    html5QrCode.stop().then(() => {
                        modal.style.display = 'none';
                        
                        // Navigate to scanned URL
                        if (decodedText.startsWith('http')) {
                            window.location.href = decodedText;
                        } else {
                            alert('Invalid QR code');
                        }
                    });
                },
                (errorMessage) => {
                    // Scanning error (ignore, happens frequently)
                }
            );
        } catch (err) {
            console.error('Error starting scanner:', err);
            alert('Failed to access camera. Please check permissions.');
            modal.style.display = 'none';
        }
    };

    // Close scanner
    document.getElementById('close-scanner').onclick = () => {
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                modal.style.display = 'none';
            }).catch(err => {
                console.error('Error stopping scanner:', err);
                modal.style.display = 'none';
            });
        } else {
            modal.style.display = 'none';
        }
    };
})();

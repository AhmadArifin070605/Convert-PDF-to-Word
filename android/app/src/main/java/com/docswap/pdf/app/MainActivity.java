package com.docswap.pdf.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SharedDocumentsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

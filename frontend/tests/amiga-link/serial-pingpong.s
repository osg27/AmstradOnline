; Amiga Link Play serial test boot block (original test program).
; On every byte r received on the serial port: COLOR00 = r, transmit (r+1)&$ff.
; If nothing arrives for ~1.5 s, transmit $00 to start (or restart) the chain.
; A transmitted byte is therefore a function of a byte the Amiga CPU itself read
; from SERDATR, which proves end-to-end delivery into the emulated UART.
        section boot,code
        dc.b    'DOS',0
        dc.l    0                 ; checksum, patched by build script
        dc.l    880
start:
        lea     $dff000,a5
        move.w  #$7fff,$9a(a5)    ; INTENA: all off
        move.w  #$7fff,$9c(a5)    ; INTREQ: clear
        move.w  #$7fff,$96(a5)    ; DMACON: all off (COLOR00 still visible)
        move.w  #$0f00,$180(a5)   ; red = waiting
        move.w  #368,$32(a5)      ; SERPER: 9600 baud, 8 data bits (PAL)
        moveq   #0,d1
loop:
        move.w  $18(a5),d0        ; SERDATR
        btst    #14,d0            ; RBF?
        beq.s   norx
        move.w  #$0800,$9c(a5)    ; acknowledge RBF
        and.w   #$00ff,d0
        move.w  d0,$180(a5)       ; show received byte as colour
        addq.b  #1,d0
        bsr.s   send
        moveq   #0,d1
        bra.s   loop
norx:
        addq.l  #1,d1
        cmp.l   #$00040000,d1
        bne.s   loop
        moveq   #0,d1
        moveq   #0,d0
        bsr.s   send              ; kick-off byte
        bra.s   loop
send:
        move.w  $18(a5),d3
        btst    #13,d3            ; TBE?
        beq.s   send
        and.w   #$00ff,d0
        or.w    #$0100,d0         ; stop bit
        move.w  d0,$30(a5)        ; SERDAT
        rts

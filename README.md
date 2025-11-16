# Travel Visit Tracker

자동으로 방문한 지역을 추적하고 지도에 시각화하는 iOS 앱입니다. Flutter로 개발되었으며, 백그라운드 위치 모니터링을 통해 사용자가 방문한 행정구역을 자동으로 기록합니다.

## 주요 기능

- 🗺️ **자동 방문 감지**: iOS Core Location을 활용한 백그라운드 지역 모니터링
- 🎨 **시각적 지도**: 방문한 지역은 초록색, 미방문 지역은 회색으로 표시
- 📸 **사진 첨부**: 방문한 지역에 사진을 첨부하여 추억 기록
- 📊 **통계 및 배지**: 방문 통계 확인 및 마일스톤 달성 배지
- 🌐 **오프라인 지원**: 인터넷 없이도 지도 확인 및 방문 기록 가능
- 🔋 **배터리 효율**: 지역 모니터링 방식으로 배터리 소모 최소화
- 🎯 **광고 기반 프리미엄**: 광고 시청으로 프리미엄 기능 잠금 해제

## 기술 스택

### Frontend (Mobile App)
- **Flutter** 3.19.6
- **MapLibre GL** - 지도 렌더링
- **Provider** - 상태 관리
- **SQLite** - 로컬 데이터 저장
- **iOS Core Location** - 위치 추적 (Swift)

### Backend
- **Node.js** + **Express**
- **Multer** - 사진 업로드
- **Sharp** - 이미지 썸네일 생성

## 프로젝트 구조

```
.
├── travel_visit_tracker/          # Flutter 앱
│   ├── lib/
│   │   ├── main.dart             # 앱 진입점
│   │   ├── models/               # 데이터 모델
│   │   ├── screens/              # UI 화면
│   │   ├── services/             # 비즈니스 로직
│   │   ├── state/                # 상태 관리
│   │   ├── utils/                # 유틸리티
│   │   └── widgets/              # 재사용 가능한 위젯
│   ├── ios/                      # iOS 네이티브 코드
│   │   └── Runner/
│   │       ├── AppDelegate.swift
│   │       └── LocationService.swift
│   └── test/                     # 테스트
│
├── backend/                       # Node.js 백엔드
│   ├── server.js                 # 서버 메인 파일
│   ├── data/                     # GeoJSON 데이터
│   │   └── KR_boundaries.geojson
│   └── uploads/                  # 업로드된 사진 (자동 생성)
│
└── README.md
```

## 시작하기

### 필수 요구사항

- **macOS** (iOS 개발용)
- **Xcode** 12.0 이상
- **Flutter** 3.19.6 이상
- **Node.js** 18 이상
- **CocoaPods**
- **iOS 기기** 또는 시뮬레이터

### 설치 및 실행

#### 1. 저장소 클론

```bash
git clone https://github.com/[your-username]/travel-visit-tracker.git
cd travel-visit-tracker
```

#### 2. 백엔드 서버 실행

```bash
cd backend
npm install
npm run dev
```

서버가 `http://localhost:3000`에서 실행됩니다.

#### 3. Flutter 앱 실행

새 터미널에서:

```bash
cd travel_visit_tracker

# 의존성 설치
flutter pub get

# iOS 의존성 설치
cd ios
pod install
cd ..

# 앱 실행
flutter run
```

#### 4. Xcode 설정 (처음 한 번만)

```bash
# Xcode 라이센스 동의
sudo xcodebuild -license

# 추가 컴포넌트 설치
sudo xcodebuild -runFirstLaunch
```

## 사용 방법

1. **앱 실행**: 앱을 실행하면 온보딩 화면이 나타납니다
2. **위치 권한 허용**: "Enable Location" 버튼을 눌러 위치 권한을 허용합니다
   - "When In Use" 권한 허용
   - "Always" 권한으로 업그레이드 (백그라운드 추적용)
3. **GeoJSON 팩 로드**: 한국(KR) 또는 다른 국가의 지역 데이터를 로드합니다
4. **방문 추적**: 앱이 백그라운드에서 자동으로 방문을 감지합니다
   - 지역에 5분 이상 머물면 방문으로 확인됩니다
   - 방문한 지역은 지도에서 초록색으로 표시됩니다
5. **사진 첨부**: 방문한 지역을 탭하여 사진을 첨부할 수 있습니다
6. **통계 확인**: 통계 화면에서 방문 현황과 배지를 확인합니다

## 주요 기능 상세

### 자동 방문 감지

- iOS의 지역 모니터링(Region Monitoring) 기능 사용
- 최대 20개의 지역을 동시에 모니터링
- 사용자 위치에 따라 동적으로 모니터링 지역 업데이트
- 5분(300초) 이상 체류 시 방문으로 확인

### 오프라인 지원

- GeoJSON 데이터를 로컬에 캐싱
- 오프라인 상태에서도 방문 기록 가능
- 사진을 로컬에 저장 후 온라인 시 자동 동기화

### 배터리 효율

- 연속 위치 추적 대신 지역 모니터링 사용
- 8시간 동안 5% 미만의 배터리 소모 목표
- 위치 업데이트는 지역 진입/이탈 시에만 발생

## API 문서

### 백엔드 API

#### GET `/api/geojson/:countryCode`

국가별 GeoJSON 경계 데이터를 가져옵니다.

**응답 예시:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "KR-11-680",
      "properties": {
        "name": "강남구",
        "admin_level": 8,
        "country_code": "KR"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [...]
      }
    }
  ]
}
```

#### POST `/api/photos`

사진을 업로드합니다.

**요청:**
- `file`: 이미지 파일 (JPEG/PNG, 최대 10MB)
- `region_id`: 지역 ID

**응답 예시:**
```json
{
  "url": "http://localhost:3000/uploads/abc123.jpg",
  "thumbnail_url": "http://localhost:3000/uploads/thumbnails/abc123_thumb.jpg",
  "region_id": "KR-11-680",
  "uploaded_at": "2025-11-14T10:30:00.000Z"
}
```

## 테스트

### 단위 테스트 실행

```bash
cd travel_visit_tracker
flutter test
```

### 통합 테스트 실행

```bash
flutter test integration_test/
```

### 필드 테스트

실제 기기에서의 필드 테스트 가이드는 [FIELD_TESTING_GUIDE.md](travel_visit_tracker/FIELD_TESTING_GUIDE.md)를 참조하세요.

## 성능 최적화

- GeoJSON 좌표 정밀도 최적화 (0.001도)
- 지도 렌더링 60 FPS 유지
- 데이터베이스 쿼리 인덱싱
- 이미지 썸네일 자동 생성 (200x200)

자세한 내용은 [PERFORMANCE_OPTIMIZATION.md](travel_visit_tracker/PERFORMANCE_OPTIMIZATION.md)를 참조하세요.

## 에러 핸들링

앱은 다음과 같은 에러 상황을 처리합니다:

- 위치 권한 거부
- GeoJSON 로드 실패
- 사진 업로드 실패
- 네트워크 연결 끊김
- 데이터베이스 오류

자세한 내용은 [ERROR_HANDLING_SUMMARY.md](travel_visit_tracker/ERROR_HANDLING_SUMMARY.md)를 참조하세요.

## 개발 문서

- [Requirements](/.kiro/specs/travel-visit-tracker/requirements.md) - 요구사항 명세
- [Design](/.kiro/specs/travel-visit-tracker/design.md) - 설계 문서
- [Tasks](/.kiro/specs/travel-visit-tracker/tasks.md) - 구현 작업 목록

## 라이선스

MIT License

## 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 문의

프로젝트에 대한 질문이나 제안사항이 있으시면 이슈를 등록해주세요.

## 스크린샷

_TODO: 앱 스크린샷 추가_

## 로드맵

- [ ] Android 지원
- [ ] 다국어 지원 (영어, 일본어)
- [ ] 더 많은 국가 GeoJSON 데이터 추가
- [ ] 소셜 공유 기능
- [ ] 방문 기록 내보내기 (CSV, PDF)
- [ ] 다크 모드 지원
- [ ] Apple Watch 앱

## 알려진 이슈

- 시뮬레이터에서는 백그라운드 위치 추적이 제한적으로 작동합니다
- 실제 기기 테스트를 권장합니다

## 감사의 말

- [MapLibre GL](https://maplibre.org/) - 오픈소스 지도 라이브러리
- [OpenStreetMap](https://www.openstreetmap.org/) - 지도 데이터
- [Flutter](https://flutter.dev/) - 크로스 플랫폼 프레임워크

window.config = {
  routerBasename: '/viewer',
  showStudyList: true,
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'Hospital RUN PACS',
        name: 'orthanc',
        wadoUriRoot: '/wado',
        qidoRoot: '/dicom-web',
        wadoRoot: '/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        bulkDataURI: {
          enabled: true,
        },
      },
    },
  ],
  defaultDataSourceName: 'dicomweb',

  // ── SSO: HIS JWT를 DICOMweb 요청에 주입 ──
  httpErrorHandler: undefined,
  customizationService: {},
  beforeSend: function (xhr) {
    // URL query parameter에서 HIS JWT 토큰 추출
    var params = new URLSearchParams(window.location.search);
    var token = params.get('token');
    if (token) {
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('X-Auth-Source', 'his-sso');
    }
    return xhr;
  },
};
